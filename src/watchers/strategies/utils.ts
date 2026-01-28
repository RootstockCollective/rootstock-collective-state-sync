import { info, debug } from 'loglevel';
import { DatabaseContext } from '../../context/db';
import { isIgnorableEntity } from '../../utils/entityUtils';
import { processBatches } from '../../utils/batch';
import { withRetry } from '../../utils/retry';
import { BlockChangeLog } from './types';
import { AppContext } from '../../context/types';
import { EntityDataCollection } from '../../handlers/types';

export const getLastProcessedBlock = async (
  db: DatabaseContext['db']
): Promise<BlockChangeLog> => {
  const result = await db<BlockChangeLog>('BlockChangeLog').orderBy('blockNumber', 'desc').first();

  return result ?? {
    id: '0x00',
    blockNumber: BigInt(0),
    blockTimestamp: BigInt(0),
    updatedEntities: []
  };
};

/**
 * Finds child entity IDs that reference the given parent IDs.
 * Recursively finds all descendants (children, grandchildren, etc.).
 * Batches queries to handle large parentId sets efficiently.
 */
export const findChildEntityIds = async (
  db: DatabaseContext['db'],
  schema: AppContext['schema'],
  parentEntityName: string,
  parentIds: string[],
  batchSize = 1000
): Promise<Map<string, Set<string>>> => {
  const childIdsMap = new Map<string, Set<string>>();
  
  if (parentIds.length === 0) return childIdsMap;
  
  // Get direct children using topological schema methods
  const childEntities = schema.getDirectChildren(parentEntityName);
  
  if (childEntities.length === 0) {
    debug(`No child entities found for ${parentEntityName}`);
    return childIdsMap;
  }
  
  debug(`Finding child IDs for ${parentEntityName}: ${childEntities.map(c => c.childEntityName).join(', ')}`);
  
  for (const { childEntityName, fkColumnName } of childEntities) {
    const childEntity = schema.entities.get(childEntityName);
    if (!childEntity) {
      debug(`Child entity ${childEntityName} not found in schema`);
      continue;
    }
    
    const [pk] = childEntity.primaryKey;
    
    // Batch parentIds to avoid query size limits using processBatches
    const allChildIds = new Set<string>();
    
    await processBatches(
      parentIds,
      batchSize,
      async (batch) => {
        // Query child entities that reference any of the parent IDs in this batch
        const childRows = await db(childEntityName)
          .whereIn(fkColumnName, batch)
          .select(pk);
        
        for (const row of childRows) {
          const id = row[pk];
          if (id) allChildIds.add(String(id));
        }
      }
    );
    
    if (allChildIds.size > 0) {
      childIdsMap.set(childEntityName, allChildIds);
      debug(`Found ${allChildIds.size} ${childEntityName} IDs referencing ${parentEntityName}`);
      
      // Recursively find grandchildren (children of children)
      // Batch the child IDs for the recursive call as well
      const grandchildIds = await findChildEntityIds(
        db,
        schema,
        childEntityName,
        Array.from(allChildIds),
        batchSize
      );
      
      // Merge grandchildren into the map
      for (const [grandchildEntityName, grandchildIdsSet] of grandchildIds.entries()) {
        const existing = childIdsMap.get(grandchildEntityName);
        if (existing) {
          grandchildIdsSet.forEach(id => existing.add(id));
        } else {
          childIdsMap.set(grandchildEntityName, grandchildIdsSet);
        }
      }
    }
  }
  
  return childIdsMap;
};

export const trackEntityIds = async (
  dbContext: AppContext['dbContext'],
  entityData: EntityDataCollection,
  blockNumber: bigint,
  blockHash: string
): Promise<void> => {
  const { db } = dbContext;

  const changeLogEntries: {
    id: string;
    blockNumber: bigint;
    blockHash: string;
    entityName: string;
    entityId: string;
  }[] = [];

  // Track only directly synced entities (lazy expansion: children will be found at reorg-time)
  for (const [entityName, records] of Object.entries(entityData)) {
    if (isIgnorableEntity(entityName)) continue;

    for (const record of records) {
      const entityId = String(record.id);
      changeLogEntries.push({
        id: `${blockNumber.toString()}-${entityName}-${entityId}`,
        blockNumber,
        blockHash,
        entityName,
        entityId
      });
    }
  }

  if (changeLogEntries.length > 0) {
    info(`Tracking ${changeLogEntries.length} entity changes in EntityChangeLog`);
    const { batchSize, maxRetries, initialRetryDelay } = dbContext;

    await processBatches(
      changeLogEntries,
      batchSize,
      async (batch) => {
        await withRetry(
          async () => {
            await db('EntityChangeLog').insert(batch).onConflict('id').merge();
          },
          maxRetries,
          initialRetryDelay
        );
      },
      {
        onProgress: (currentBatch, totalBatches, processedItems, totalItems) => {
          info(`Processed ${currentBatch}/${totalBatches} batches (${processedItems}/${totalItems} entries)`);
        }
      }
    );
  }
};
