import { info, warn, debug } from 'loglevel';
import { Hex, PublicClient } from 'viem';

import { AppContext } from '../../context/types';
import { isIgnorableEntity } from '../../utils/entityUtils';
import { ChangeStrategy, BlockChangeLog } from './types';
import { getLastProcessedBlock } from './utils';
import { syncEntities, syncEntitiesByIds } from '../../handlers/subgraphSyncer';

const MAX_BLOCKCHANGELOG_CHECK = 200;
const REWIND_BUFFER = 50n;

interface Ancestor { blockNumber: bigint; blockHash: string };

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

  if (startStored && startStored.id === startBlockHash) {
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
      if (onchain.hash === convertDbIdToHash(stored.id)) return { blockNumber: bn, blockHash: onchain.hash };
    } catch (e) {
      warn(`Error checking block ${stored.blockNumber}: ${e}`);
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
  info(`Deleted ${deletedEcl} EntityChangeLog rows with syncFromBlock >= ${rewindFrom}`);

  const deletedBcl = await db<BlockChangeLog>('BlockChangeLog')
    .where('blockNumber', '>', rewindFrom.toString())
    .delete();
  info(`Deleted ${deletedBcl} BlockChangeLog rows with blockNumber > ${rewindFrom}`);
};

const updateLastProcessedToAncestor = async (
  db: AppContext['dbContext']['db'],
  client: PublicClient,
  ancestor: Ancestor
): Promise<void> => {
  const onchain = await client.getBlock({ blockNumber: ancestor.blockNumber });
  await db('LastProcessedBlock')
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
  touched: Map<string, Set<string>>
): Promise<void> => {
  for (const [entityName, idsSet] of touched.entries()) {
    const entity = schema.entities.get(entityName);
    if (!entity) continue;

    const ids = Array.from(idsSet);
    if (ids.length === 0) continue;

    // assuming primaryKey is ['id'] in your schema (most are)
    const [pk] = entity.primaryKey;
    await db(entityName).whereIn(pk, ids).delete();
  }
};

const truncateEntities = async (
  db: AppContext['dbContext']['db'],
  entityNames: string[]
): Promise<void> => {
  for (const name of entityNames) {
    await db(name).delete();
  }
};

const performFullRebuild = async (
  context: AppContext
): Promise<void> => {
  const { dbContext, schema } = context;
  const { db } = dbContext;

  info('Performing full rebuild: deleting all collective-rewards tables');

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

  if (allCollectiveRewardsEntities.length > 0) {
    const deleteOrder = schema.getDeleteOrder(allCollectiveRewardsEntities);
    info(`Deleting ${deleteOrder.length} collective-rewards entities in FK-safe order`);
    await truncateEntities(db, deleteOrder);
  }

  // Delete tracking tables
  info('Deleting tracking tables');
  await db('EntityChangeLog').delete();
  await db('BlockChangeLog').delete();

  // Reset LastProcessedBlock to initial state
  info('Resetting LastProcessedBlock to initial state');
  await db('LastProcessedBlock')
    .insert({
      id: true,
      hash: '0x00',
      number: 0n,
      timestamp: 0n,
    })
    .onConflict('id')
    .merge();

  // Sync all entities from scratch (like initial sync)
  info(`Syncing ${allCollectiveRewardsEntities.length} collective-rewards entities from scratch`);
  await syncEntities(context, allCollectiveRewardsEntities);

  info('Full rebuild complete. All collective-rewards tables have been deleted and resynced.');
};

export const revertReorgsStrategy = (): ChangeStrategy => {
  const detectAndProcess = async ({
    client,
    context,
  }: {
    context: AppContext;
    client: PublicClient;
  }): Promise<boolean> => {
    const { dbContext, schema } = context;
    const { db } = dbContext;

    const { id, blockNumber: storedNumber } = await getLastProcessedBlock(db);
    const storedHash = convertDbIdToHash(id);
    if (storedNumber === 0n) return false;
    const onchain = await client.getBlock({ blockNumber: storedNumber });
    if (onchain.hash.toLowerCase() === storedHash.toLowerCase()) {
      debug(`No reorg detected @${storedNumber}. stored=${storedHash} onchain=${onchain.hash}`);
      return false;
    }
    info(`Reorg detected @${storedNumber}. stored=${storedHash} onchain=${onchain.hash}`);
    const ancestor = await findCommonAncestorSparse(client, db, storedNumber, storedHash);

    if (!ancestor) {
      warn(`No ancestor found in last ${MAX_BLOCKCHANGELOG_CHECK} BlockChangeLog entries; performing full rebuild.`);
      await performFullRebuild(context);
      return true;
    }

    const rewindFrom = rewindFromAncestor(ancestor);
    info(`ancestor=${ancestor.blockNumber} rewindFrom=${rewindFrom} (buffer=${REWIND_BUFFER})`);

    // Entities affected by reverted window
    const affected = await getAffectedEntityTypes(db, schema, rewindFrom, storedNumber);
    info(`Affected entities: total=${affected.length}`);

    if (affected.length > 0) {
      const touched = await getTouchedIdsSince(db, rewindFrom, affected);

      if (touched.size > 0) {
        await deleteTouchedIds(db, schema, touched);
        await syncEntitiesByIds(context, touched);
      } else {
        warn(`No touched IDs found since ${rewindFrom}. Falling back to truncate+resync for affected entities.`);
        const deleteOrder = schema.getDeleteOrder(affected);

        await truncateEntities(db, deleteOrder);

        // no hash => no EntityChangeLog tracking pollution
        await syncEntities(context, affected, rewindFrom);
      }
    }

    // Tracking cleanup + rebuild BlockChangeLog from rewindFrom
    await cleanupTracking(db, rewindFrom);

    // Rebuild BlockChangeLog (no hash => no tracking)
    await syncEntities(context, ['BlockChangeLog'], rewindFrom);

    // Reset checkpoint to ancestor
    await updateLastProcessedToAncestor(db, client, ancestor);

    info('Reorg recovery complete.');
    return true;
  };

  return { name: 'reorgCleanupStrategy', detectAndProcess };
};
