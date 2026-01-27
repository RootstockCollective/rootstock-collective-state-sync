import log from 'loglevel';
import type { Knex } from 'knex';

import { executeRequests } from '../context/subgraphProvider';
import { AppContext } from '../context/types';
import { chunk } from '../utils/batch';
import { executeUpsert } from './dbUpsert';
import { createEntityQueries, createEntityQuery } from './subgraphQueryBuilder';
import { EntityDataCollection } from './types';

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

const processEntityData = async (
  context: AppContext,
  entityData: EntityDataCollection,
  trx?: Knex.Transaction
): Promise<void> => {
  const { dbContext, schema } = context;
  
  // Filter to entities that have data
  const entityNamesWithData = Object.keys(entityData).filter(
    entityName => entityData[entityName]?.length > 0
  );
  
  if (entityNamesWithData.length === 0) {
    log.info('No entity data to process');
    return;
  }
  
  // Get FK-safe upsert order using topological sort (parents before children)
  const orderedEntityNames = schema.getUpsertOrder(entityNamesWithData);
  log.info(`Processing ${orderedEntityNames.length} entities in FK-safe order: ${orderedEntityNames.join(', ')}`);
  
  // Process entities in FK-safe order
  for (const entityName of orderedEntityNames) {
    const data = entityData[entityName];
    // Note: data is guaranteed to exist and have length > 0 due to filtering above,
    // but keeping check for type safety
    if (data?.length > 0) {
      log.info(`Upserting ${data.length} records for ${entityName}`);
      await executeUpsert(dbContext, entityName, data, schema, trx);
    }
  }
  
  log.info('Completed processing all data');
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

    let requests = createEntityQueries(schema, subgraphEntities, {
      first: graphqlContext.pagination.maxRowsPerRequest,
      filters: buildFilters(undefined, blockNumber)
    });

    while (requests.length > 0) {
      const results = await executeRequests(graphqlContext, requests);

      requests = [];
      for (const [entityName, data] of Object.entries(results)) {
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


const syncEntities = async (
  context: AppContext,
  entities: string[],
  blockNumber?: bigint,
  trx?: Knex.Transaction
): Promise<EntityDataCollection> => {
  const entityData = await collectEntityData(context, entities, blockNumber);
  await processEntityData(context, entityData, trx);

  return entityData;
};

const collectEntityDataByIds = async (
  context: AppContext,
  entityIdsByEntity: Map<string, Set<string>>,
): Promise<EntityDataCollection> => {
  const { schema, graphqlContexts } = context;

  const requestsBySubgraph = new Map<string, ReturnType<typeof createEntityQuery>[]>();

  for (const [entityName, idsSet] of entityIdsByEntity.entries()) {
    const ent = schema.entities.get(entityName);
    if (!ent) continue;

    const subgraphName = ent.subgraphProvider;
    const gql = graphqlContexts[subgraphName];
    if (!gql) continue;

    const ids = Array.from(idsSet);
    if (ids.length === 0) continue;

    const idChunks = chunk(ids, gql.pagination.maxRowsPerRequest);

    const reqs = idChunks.map(idsChunk =>
      createEntityQuery(schema, entityName, {
        filters: { id_in: idsChunk },
      })
    );

    requestsBySubgraph.set(subgraphName, [...(requestsBySubgraph.get(subgraphName) ?? []), ...reqs]);
  }

  const entityData: EntityDataCollection = {};

  for (const [subgraphName, reqs] of requestsBySubgraph.entries()) {
    const gql = graphqlContexts[subgraphName];
    if (!gql) continue;

    for (const batch of chunk(reqs, gql.pagination.maxRowsPerRequest)) {
      const results = (await executeRequests(gql, batch)) as EntityDataCollection;

      for (const [entityName, rows] of Object.entries(results)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;

        entityData[entityName] = [...(entityData[entityName] ?? []), ...rows];
      }
    }
  }

  return entityData;
};


export { syncEntities, collectEntityDataByIds, collectEntityData, processEntityData };
