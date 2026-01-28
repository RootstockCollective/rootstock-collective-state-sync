import log from 'loglevel';
import { Hex, PublicClient } from 'viem';
import type { Knex } from 'knex';

import { AppContext } from '../../context/types';
import { isIgnorableEntity } from '../../utils/entityUtils';
import { Mutex } from '../../utils/mutex';
import { ChangeStrategy, ChangeStrategyParams, BlockChangeLog } from './types';
import { getLastProcessedBlock, findChildEntityIds } from './utils';
import { syncEntities, collectEntityDataByIds, collectEntityData, processEntityData } from '../../handlers/subgraphSyncer';

const MAX_BLOCKCHANGELOG_CHECK = 200;
const REWIND_BUFFER = 50n;
// Keep EntityChangeLog entries for this many blocks beyond the reorg detection window
// This provides a safety buffer for reorg detection while preventing unbounded growth
const ENTITY_CHANGELOG_RETENTION_BUFFER = 100n;
const ENTITY_CHANGELOG_RETENTION_BLOCKS = BigInt(MAX_BLOCKCHANGELOG_CHECK) + REWIND_BUFFER + ENTITY_CHANGELOG_RETENTION_BUFFER;

interface Ancestor { blockNumber: bigint; blockHash: string };

// Mutex to prevent concurrent reorg cleanup operations and block other strategies
// This ensures only one reorg cleanup runs at a time, preventing database conflicts
const reorgCleanupMutex = new Mutex();

/**
 * Check if reorg cleanup is currently in progress
 */
export const isReorgCleanupInProgress = (): boolean => {
  return reorgCleanupMutex.isLocked();
};

const uniq = <T>(xs: T[]) => Array.from(new Set(xs));
const clampToZero = (n: bigint) => (n < 0n ? 0n : n);
const rewindFromAncestor = (a: Ancestor) => clampToZero(a.blockNumber - REWIND_BUFFER);
const convertDbIdToHash = (id: string): Hex => {
  return Buffer.from(id, 'hex').toString('utf-8') as Hex;
};


const findCommonAncestorSparse = async (
  client: PublicClient,
  db: AppContext['dbContext']['db'],
  startBlockNumber: bigint,
  startBlockHash: string
): Promise<Ancestor | null> => {
  // First check direct match at start
  const startStored = await db<BlockChangeLog>('BlockChangeLog')
    .where('blockNumber', startBlockNumber.toString())
    .first();

  if (startStored && convertDbIdToHash(startStored.id).toLowerCase() === startBlockHash.toLowerCase()) {
    return { blockNumber: startBlockNumber, blockHash: startBlockHash };
  }

  // Scan last K changelog entries
  const recent = await db<BlockChangeLog>('BlockChangeLog')
    .orderBy('blockNumber', 'desc')
    .limit(MAX_BLOCKCHANGELOG_CHECK);
  for (const stored of recent) {
    try {
      const bn = BigInt(stored.blockNumber);
      const onchain = await client.getBlock({ blockNumber: bn });
      if (onchain.hash.toLowerCase() === convertDbIdToHash(stored.id).toLowerCase()) return { blockNumber: bn, blockHash: onchain.hash };
    } catch (e) {
      log.warn(`Error checking block ${stored.blockNumber}: ${e}`);
    }
  }

  return null;
};

const getAffectedEntityTypes = async (
  db: AppContext['dbContext']['db'],
  schema: AppContext['schema'],
  rewindFrom: bigint,
  storedBlockNumber: bigint
): Promise<string[]> => {
  const blocks = await db<BlockChangeLog>('BlockChangeLog')
    .where('blockNumber', '>', rewindFrom.toString())
    .where('blockNumber', '<=', storedBlockNumber.toString())
    .orderBy('blockNumber', 'asc');

  const names = uniq(blocks.flatMap(b => b.updatedEntities ?? []));
  return names.filter(n => {
    const entity = schema.entities.get(n);
    return entity
      && entity.subgraphProvider === 'collective-rewards'
      && !isIgnorableEntity(n);
  });
};



const getTouchedIdsSince = async (
  db: AppContext['dbContext']['db'],
  syncFromBlockGte: bigint,
  entityNames: string[]
): Promise<Map<string, Set<string>>> => {
  if (entityNames.length === 0) return new Map();

  const rows: { entityName: string; entityId: string }[] = await db('EntityChangeLog')
    .where('blockNumber', '>=', syncFromBlockGte.toString())
    .whereIn('entityName', entityNames)
    .select('entityName', 'entityId');

  return rows.reduce<Map<string, Set<string>>>((acc, r) => {
    const name = r.entityName;
    const id = r.entityId;
    let ids = acc.get(name);
    if (!ids) {
      ids = new Set();
      acc.set(name, ids);
    }
    ids.add(id);
    return acc;

  }, new Map<string, Set<string>>());
};


const cleanupTracking = async (
  db: AppContext['dbContext']['db'],
  rewindFrom: bigint
): Promise<void> => {
  // EntityChangeLog.blockNumber == syncFromBlock
  const deletedEcl = await db('EntityChangeLog')
    .where('blockNumber', '>=', rewindFrom.toString())
    .delete();
  log.info(`Deleted ${deletedEcl} EntityChangeLog rows with syncFromBlock >= ${rewindFrom}`);

  const deletedBcl = await db<BlockChangeLog>('BlockChangeLog')
    .where('blockNumber', '>', rewindFrom.toString())
    .delete();
  log.info(`Deleted ${deletedBcl} BlockChangeLog rows with blockNumber > ${rewindFrom}`);
};

/**
 * Prunes old EntityChangeLog entries beyond the reorg detection window.
 * This prevents unbounded growth when no reorgs occur.
 * Keeps entries for ENTITY_CHANGELOG_RETENTION_BLOCKS blocks.
 */
export const pruneOldEntityChangeLog = async (
  db: AppContext['dbContext']['db'],
  currentBlockNumber: bigint
): Promise<void> => {
  const cutoffBlock = clampToZero(currentBlockNumber - ENTITY_CHANGELOG_RETENTION_BLOCKS);

  if (cutoffBlock === 0n) {
    // Don't prune if we haven't processed enough blocks yet
    return;
  }

  const deleted = await db('EntityChangeLog')
    .where('blockNumber', '<', cutoffBlock.toString())
    .delete();

  if (deleted > 0) {
    log.info(`Pruned ${deleted} old EntityChangeLog entries older than block ${cutoffBlock} (retention: ${ENTITY_CHANGELOG_RETENTION_BLOCKS} blocks)`);
  }
};

const updateLastProcessedToAncestor = async (
  db: AppContext['dbContext']['db'],
  client: PublicClient,
  ancestor: Ancestor,
  trx?: Knex.Transaction
): Promise<void> => {
  const dbOrTrx = trx ?? db;
  const onchain = await client.getBlock({ blockNumber: ancestor.blockNumber });
  await dbOrTrx('LastProcessedBlock')
    .where('id', true)
    .update({
      hash: ancestor.blockHash,
      number: ancestor.blockNumber,
      timestamp: onchain.timestamp,
    });
};


const deleteTouchedIds = async (
  db: AppContext['dbContext']['db'],
  schema: AppContext['schema'],
  touched: Map<string, Set<string>>,
  trx?: Knex.Transaction
): Promise<void> => {
  const dbOrTrx = trx ?? db;
  for (const [entityName, idsSet] of touched.entries()) {
    const entity = schema.entities.get(entityName);
    if (!entity) continue;

    const ids = Array.from(idsSet);
    if (ids.length === 0) continue;

    // assuming primaryKey is ['id'] in your schema (most are)
    const [pk] = entity.primaryKey;
    await dbOrTrx(entityName).whereIn(pk, ids).delete();
  }
};

const truncateEntities = async (
  db: AppContext['dbContext']['db'],
  entityNames: string[],
  trx?: Knex.Transaction
): Promise<void> => {
  const dbOrTrx = trx ?? db;
  for (const name of entityNames) {
    await dbOrTrx(name).delete();
  }
};

const performFullRebuild = async (
  context: AppContext
): Promise<void> => {
  const { dbContext, schema } = context;
  const { db } = dbContext;

  log.info('Performing full rebuild: deleting all collective-rewards tables');

  // Get all collective-rewards entities (excluding tracking entities)
  const allCollectiveRewardsEntities: string[] = [];
  for (const [entityName, entity] of schema.entities.entries()) {
    if (
      entity.subgraphProvider === 'collective-rewards' &&
      !isIgnorableEntity(entityName)
    ) {
      allCollectiveRewardsEntities.push(entityName);
    }
  }

  // Fetch all data FIRST (read-only, no DB writes)
  // This batches all subgraph queries efficiently together
  log.info(`Fetching data for ${allCollectiveRewardsEntities.length} collective-rewards entities before delete+insert`);
  const entityData = await collectEntityData(context, allCollectiveRewardsEntities);

  // Then wrap all delete + insert operations in transaction
  await db.transaction(async (trx) => {
    if (allCollectiveRewardsEntities.length > 0) {
      const deleteOrder = schema.getDeleteOrder(allCollectiveRewardsEntities);
      log.info(`Deleting ${deleteOrder.length} collective-rewards entities in FK-safe order`);
      await truncateEntities(db, deleteOrder, trx);
    }

    // Delete tracking tables
    log.info('Deleting tracking tables');
    await trx('EntityChangeLog').delete();
    await trx('BlockChangeLog').delete();

    // Reset LastProcessedBlock to initial state
    log.info('Resetting LastProcessedBlock to initial state');
    await trx('LastProcessedBlock')
      .insert({
        id: true,
        hash: '0x00',
        number: 0n,
        timestamp: 0n,
      })
      .onConflict('id')
      .merge();

    // Sync all entities from scratch (like initial sync)
    log.info(`Resyncing ${allCollectiveRewardsEntities.length} collective-rewards entities from scratch`);
    await processEntityData(context, entityData, trx);
  });

  log.info('Full rebuild complete. All collective-rewards tables have been deleted and resynced.');
};

export const revertReorgsStrategy = (): ChangeStrategy => {
  const detectAndProcess = async ({
    client,
    context,
  }: ChangeStrategyParams): Promise<boolean> => {
    const { dbContext, schema } = context;
    const { db } = dbContext;

    const { id, blockNumber } = await getLastProcessedBlock(db);
    const storedHash = convertDbIdToHash(id);
    const storedNumber = BigInt(blockNumber);
    if (storedNumber === 0n) return false;
    const onchain = await client.getBlock({ blockNumber: storedNumber });
    if (onchain.hash.toLowerCase() === storedHash.toLowerCase()) {
      log.debug(`No reorg detected @${storedNumber}. stored=${storedHash} onchain=${onchain.hash}`);
      return false;
    }
    log.info(`Reorg detected @${storedNumber}. stored=${storedHash} onchain=${onchain.hash}`);

    // Acquire lock before starting reorg cleanup
    // Note: shouldProcessBlock() is called before strategies run in blockWatcher,
    // so the lock should always be available here. This lock prevents concurrent cleanup
    // if this strategy is ever called directly from elsewhere.
    const releaseLock = reorgCleanupMutex.acquire();

    try {
      const ancestor = await findCommonAncestorSparse(client, db, storedNumber, storedHash);

      if (!ancestor) {
        log.warn(`No ancestor found in last ${MAX_BLOCKCHANGELOG_CHECK} BlockChangeLog entries; performing full rebuild.`);
        await performFullRebuild(context);
        return true;
      }

      const rewindFrom = rewindFromAncestor(ancestor);
      log.info(`ancestor=${ancestor.blockNumber} rewindFrom=${rewindFrom} (buffer=${REWIND_BUFFER})`);

      // Entities affected by reverted window
      const affected = await getAffectedEntityTypes(db, schema, rewindFrom, storedNumber);
      log.info(`Affected entities: total=${affected.length}`);

      if (affected.length > 0) {
        const touched = await getTouchedIdsSince(db, rewindFrom, affected);

        if (touched.size > 0) {
          // Lazy expansion: Use FK graph to transitively find all child entities
          // Run DB SELECT childPk FROM child WHERE fkCol IN (parentIds) to accumulate child IDs transitively
          // findChildEntityIds already recurses to find all descendants, so we just call it once per touched entity
          log.info(`Expanding FK graph transitively for ${touched.size} touched entity types...`);
          const allIdsToSync = new Map<string, Set<string>>(touched);

          // Process entities in topological order for clarity (parents before children)
          // Note: Using allIdsToSync.get() instead of touched.get() ensures we process
          // entities that might have been merged from previous iterations, though recursion
          // in findChildEntityIds already handles all descendants automatically
          const touchedEntityNames = Array.from(touched.keys());
          const topoOrder = schema.getUpsertOrder(touchedEntityNames);

          for (const parentEntityName of topoOrder) {
            const parentIdsSet = allIdsToSync.get(parentEntityName);
            if (!parentIdsSet) continue;

            const parentIds = Array.from(parentIdsSet);
            log.info(`  Finding children of ${parentEntityName} (${parentIds.length} IDs)...`);

            // findChildEntityIds recurses to find all descendants (children, grandchildren, etc.)
            const childIds = await findChildEntityIds(db, schema, parentEntityName, parentIds, dbContext.batchSize);

            // Merge child IDs into the sync map
            for (const [childEntityName, childIdsSet] of childIds.entries()) {
              const existing = allIdsToSync.get(childEntityName);
              if (existing) {
                childIdsSet.forEach(id => existing.add(id));
              } else {
                allIdsToSync.set(childEntityName, new Set(childIdsSet));
              }
            }

            if (childIds.size > 0) {
              const totalChildIds = Array.from(childIds.values()).reduce((sum, ids) => sum + ids.size, 0);
              log.info(`    Found ${totalChildIds} child IDs across ${childIds.size} child type(s)`);
            }
          }

          const childEntitiesOnly = Array.from(allIdsToSync.keys()).filter(name => !touched.has(name));
          if (childEntitiesOnly.length > 0) {
            log.info(`Expanded to ${allIdsToSync.size} entity types total (${childEntitiesOnly.length} child types added): ${Array.from(allIdsToSync.keys()).join(', ')}`);
          }

          // Fetch all data FIRST (read-only, no DB writes)
          // This batches all subgraph queries efficiently together
          log.info(`Fetching data for ${allIdsToSync.size} entity types before delete+insert`);
          const entityData = await collectEntityDataByIds(context, allIdsToSync);

          // Then wrap delete + insert in transaction
          await db.transaction(async (trx) => {
            // Delete touched IDs (CASCADE will delete children)
            await deleteTouchedIds(db, schema, touched, trx);

            // Rehydrate via id_in queries in topological upsert order
            const allEntityNames = Array.from(allIdsToSync.keys());
            const upsertOrder = schema.getUpsertOrder(allEntityNames);
            log.info(`Resyncing ${allEntityNames.length} entity types in FK-safe upsert order: ${upsertOrder.join(', ')}`);
            await processEntityData(context, entityData, trx);
          });
        } else {
          log.warn(`No touched IDs found since ${rewindFrom}. Falling back to truncate+resync for affected entities.`);
          const deleteOrder = schema.getDeleteOrder(affected);

          // Fetch all data FIRST (read-only, no DB writes)
          log.info(`Fetching data for ${affected.length} affected entities before truncate+insert`);
          const entityData = await collectEntityData(context, affected, rewindFrom);

          // Then wrap truncate + insert in transaction
          await db.transaction(async (trx) => {
            await truncateEntities(db, deleteOrder, trx);
            // no hash => no EntityChangeLog tracking pollution
            await processEntityData(context, entityData, trx);
          });
        }
      }

      // Tracking cleanup + rebuild BlockChangeLog from rewindFrom
      // These operations don't need to be in the same transaction as the main entity sync
      await cleanupTracking(db, rewindFrom);

      // Rebuild BlockChangeLog (no hash => no tracking)
      await syncEntities(context, ['BlockChangeLog'], rewindFrom);

      // Reset checkpoint to ancestor
      await updateLastProcessedToAncestor(db, client, ancestor);

      log.info('Reorg recovery complete.');
      return true;
    } finally {
      // Release lock
      releaseLock();
    }
  };

  return { name: 'reorgCleanupStrategy', detectAndProcess };
};
