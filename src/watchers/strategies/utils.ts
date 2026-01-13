import { info } from 'loglevel';
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
