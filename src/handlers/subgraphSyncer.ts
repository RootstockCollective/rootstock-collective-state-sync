import log from 'loglevel';

import { executeRequests } from '../context/subgraphProvider';
import { GraphQLMetadata } from '../context/subgraphProvider';
import { AppContext } from '../context/types';
import { executeUpsert } from './dbUpsert';
import { createEntityQueries } from './subgraphQueryBuilder';
import { EntityDataCollection, WithMetadata } from './types';

interface EntitySyncStatus {
    entityName: string;
    lastProcessedId: string | null;
    isComplete: boolean;
    totalProcessed: number;
}


const createInitialStatus = (entityName: string): EntitySyncStatus => ({
  entityName,
  lastProcessedId: null,
  isComplete: false,
  totalProcessed: 0
});

const updateStatus = (
  currentStatus: EntitySyncStatus,
  lastId: string | null,
  processedCount: number,
  maxRowsPerRequest: number
): EntitySyncStatus => {
  const isComplete = processedCount < maxRowsPerRequest;
  return {
    ...currentStatus,
    lastProcessedId: lastId,
    isComplete,
    totalProcessed: currentStatus.totalProcessed + processedCount
  };
};

const buildFilters = (lastProcessedId: string | undefined, blockNumber?: bigint) => ({
  ...(lastProcessedId ? { id_gt: lastProcessedId } : { id_gt: '0x00' }),
  ...(blockNumber ? { _change_block: { number_gte: blockNumber } } : {}),
});

interface SubgraphMetadataRecord {
  id: string;
  blockNumber: bigint | string;
  blockHash: string;
  blockTimestamp: bigint | string;
  deployment: string;
  hasIndexingErrors: boolean;
}

const saveSubgraphMetadata = async (
  context: AppContext,
  subgraphName: string,
  metadata: GraphQLMetadata
): Promise<void> => {
  if (!context.schema.entities.has('SubgraphMetadata')) {
    return;
  }
  
  try {
    await context.dbContext.db<SubgraphMetadataRecord>('SubgraphMetadata')
      .insert({
        id: subgraphName,
        blockNumber: metadata.block.number,
        blockHash: metadata.block.hash,
        blockTimestamp: metadata.block.timestamp,
        deployment: metadata.deployment,
        hasIndexingErrors: metadata.hasIndexingErrors,
      })
      .onConflict('id')
      .merge();
    log.debug(`Saved SubgraphMetadata for ${subgraphName}`);
  } catch (error) {
    log.error(`Failed to save SubgraphMetadata for ${subgraphName}`, error);
  }
};

const collectEntityData = async (
  context: AppContext,
  entities: string[],
  blockNumber?: bigint,
): Promise<EntityDataCollection> => {
  const { schema, graphqlContexts } = context;
    
  // Group entities by their subgraph
  const entitiesBySubgraph: Record<string, string[]> = {};
  for (const entityName of entities) {
    const entity = schema.entities.get(entityName);
    if (!entity) {
      log.warn(`Entity ${entityName} not found in schema`);
      continue;
    }
    
    if (entity.syncable === false) {
      continue;
    }
        
    const subgraphName = entity.subgraphProvider;
    if (!graphqlContexts[subgraphName]) {
      log.warn(`Subgraph context for ${subgraphName} not found`);
      continue;
    }
        
    if (!entitiesBySubgraph[subgraphName]) {
      entitiesBySubgraph[subgraphName] = [];
    }
    entitiesBySubgraph[subgraphName].push(entityName);
  }

  const entityStatus: Record<string, EntitySyncStatus> = entities.reduce((acc, entityName) => {
    acc[entityName] = createInitialStatus(entityName);
    return acc;
  }, {} as Record<string, EntitySyncStatus>);

  const entityData: EntityDataCollection = {};

  // Process each subgraph separately
  for (const [subgraphName, subgraphEntities] of Object.entries(entitiesBySubgraph)) {
    const graphqlContext = graphqlContexts[subgraphName];
    
    const shouldRequestMetadata = context.schema.entities.has('SubgraphMetadata');
    let isFirstBatch = true;
        
    let requests = createEntityQueries(schema, subgraphEntities, {
      first: graphqlContext.pagination.maxRowsPerRequest,
      filters: buildFilters(undefined, blockNumber)
    });
    
    if (shouldRequestMetadata && requests.length > 0) {
      requests[0] = {
        ...requests[0],
        withMetadata: true
      };
    }

    while (requests.length > 0) {
      const results = await executeRequests(graphqlContext, requests);
      
      if (shouldRequestMetadata && isFirstBatch) {
        const resultsWithMeta = results as EntityDataCollection<WithMetadata>;
        if (resultsWithMeta._meta) {
          await saveSubgraphMetadata(context, subgraphName, resultsWithMeta._meta);
        }
        isFirstBatch = false;
      }

      requests = [];
      for (const [entityName, data] of Object.entries(results)) {
        if (entityName === '_meta') continue;
        const currentStatus = entityStatus[entityName];
        if (!currentStatus) {
          throw new Error(`No status found for entity "${entityName}"`);
        }

        const lastId = data.length > 0 ? data[data.length - 1].id : null;
        log.info(`Entity ${entityName}: Last ID from batch: ${lastId}, Records in batch: ${data.length}`);

        const newStatus = updateStatus(
          currentStatus,
                    lastId as string | null,
                    data.length,
                    graphqlContext.pagination.maxRowsPerRequest
        );
        entityStatus[entityName] = newStatus;
        log.info(`Entity ${entityName} status:`, {
          lastProcessedId: newStatus.lastProcessedId,
          isComplete: newStatus.isComplete,
          totalProcessed: newStatus.totalProcessed
        });

        if (!newStatus.isComplete && newStatus.lastProcessedId) {
          const nextQueries = createEntityQueries(schema, [entityName], {
            first: graphqlContext.pagination.maxRowsPerRequest,
            filters: buildFilters(newStatus.lastProcessedId, blockNumber)
          });
          requests.push(...nextQueries);
        } else {
          log.info(`No more queries needed for ${entityName}. Complete: ${newStatus.isComplete}, Last ID: ${newStatus.lastProcessedId}`);
        }

        if (data.length > 0) {
          const existingData = entityData[entityName] || [];
          entityData[entityName] = [...existingData, ...data];
        }

        log.info(`Processed ${newStatus.totalProcessed} records for ${entityName}`);
      }

      log.info(`Created ${requests.length} queries for next batch`);
    }
  }

  return entityData;
};

const processEntityData = async (
  context: AppContext,
  entityData: EntityDataCollection
): Promise<void> => {
  const { dbContext, schema } = context;
  log.info('Processing all collected data...');
  for (const [entityName, data] of Object.entries(entityData)) {
    if (data.length > 0) {
      log.info(`Upserting ${data.length} records for ${entityName}`);
      await executeUpsert(dbContext, entityName, data, schema);
    }
  }
  log.info('Completed processing all data');
};

const syncEntities = async (
  context: AppContext,
  entities: string[],
  blockNumber?: bigint,
): Promise<void> => {
  const entityData = await collectEntityData(context, entities, blockNumber);
  await processEntityData(context, entityData);
};

export { syncEntities, processEntityData };

