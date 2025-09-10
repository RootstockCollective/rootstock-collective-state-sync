import log from 'loglevel';

import { executeRequests } from '../context/subgraphProvider';
import { createEntityQuery } from './subgraphQueryBuilder';
import { executeUpsert } from './dbUpsert';
import { AppContext } from '../context/types';
import { EntityDataCollection } from './types';

// ---------------- Types ----------------

interface EntitySyncStatus {
  entityName: string;
  lastProcessedId: string | null;
  isComplete: boolean;
  totalProcessed: number;
}

type Strategy = 'paginate' | 'single' | 'skip';

interface StrategyDef {
  createQuery: (
    schema: AppContext['schema'],
    entityName: string,
    lastProcessedId?: string,
    blockNumber?: bigint,
    maxRowsPerRequest?: number
  ) => ReturnType<typeof createEntityQuery> | null;

  updateStatus: (
    currentStatus: EntitySyncStatus,
    lastId: string | null,
    processedCount: number,
    maxRowsPerRequest: number
  ) => EntitySyncStatus;
}

// ---------------- Helpers ----------------

const createInitialStatus = (entityName: string): EntitySyncStatus => ({
  entityName,
  lastProcessedId: null,
  isComplete: false,
  totalProcessed: 0
});

const buildFilters = (lastProcessedId: string | null | undefined, blockNumber?: bigint) => ({
  ...(lastProcessedId ? { id_gt: lastProcessedId } : { id_gt: '0x00' }),
  ...(blockNumber ? { _change_block: { number_gte: blockNumber } } : {})
});

// ---------------- Strategies ----------------

const strategies: Record<Strategy, StrategyDef> = {
  skip: {
    createQuery: () => null,
    updateStatus: (status) => ({ ...status, isComplete: true }) // skip = always complete
  },
  single: {
    createQuery: (schema, entityName, _lastId, blockNumber) =>
      createEntityQuery(schema, entityName, {
        first: 1,
        filters: buildFilters(undefined, blockNumber)
      }),
    updateStatus: (status, lastId, processedCount) => ({
      ...status,
      lastProcessedId: lastId,
      totalProcessed: status.totalProcessed + processedCount,
      isComplete: true // single always completes after 1 request
    })
  },
  paginate: {
    createQuery: (schema, entityName, lastId, blockNumber, maxRowsPerRequest) =>
      createEntityQuery(schema, entityName, {
        first: maxRowsPerRequest,
        filters: buildFilters(lastId, blockNumber)
      }),
    updateStatus: (status, lastId, processedCount, maxRowsPerRequest) => ({
      ...status,
      lastProcessedId: lastId,
      totalProcessed: status.totalProcessed + processedCount,
      isComplete: processedCount < maxRowsPerRequest
    })
  }
};

// ---------------- Strategy Selector ----------------

// In the future, you could load this from config
const entityStrategies: Record<string, Strategy> = {
  BlockChangeLog: 'single'
};

const getStrategy = (entityName: string): Strategy =>
  entityStrategies[entityName] ?? 'paginate';

// ---------------- Core Logic ----------------

const collectEntityData = async (
  context: AppContext,
  entities: string[],
  blockNumber?: bigint
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

  const entityStatus: Record<string, EntitySyncStatus> = entities.reduce(
    (acc, entityName) => {
      acc[entityName] = createInitialStatus(entityName);
      return acc;
    },
    {} as Record<string, EntitySyncStatus>
  );

  const entityData: EntityDataCollection = {};

  for (const [subgraphName, subgraphEntities] of Object.entries(entitiesBySubgraph)) {
    const graphqlContext = graphqlContexts[subgraphName];

    let requests = subgraphEntities
      .map(entityName => {
        const strategy = strategies[getStrategy(entityName)];
        return strategy.createQuery(
          schema,
          entityName,
          undefined,
          blockNumber,
          graphqlContext.pagination.maxRowsPerRequest
        );
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    while (requests.length > 0) {
      const results = await executeRequests(graphqlContext, requests);
      requests = [];

      for (const [entityName, data] of Object.entries(results)) {
        const strategy = getStrategy(entityName);
        const strat = strategies[strategy];
        const currentStatus = entityStatus[entityName]
        if (!currentStatus) {
          throw new Error(`No status found for entity "${entityName}"`);
        }

        const lastId = data.length > 0 ? data[data.length - 1].id : null;

        log.info(
          `Entity ${entityName}: Last ID from batch: ${lastId}, Records in batch: ${data.length}`
        );

        const updated = strat.updateStatus(
          currentStatus,
          lastId,
          data.length,
          graphqlContext.pagination.maxRowsPerRequest
        );
        entityStatus[entityName] = updated;

        log.info(`Entity ${entityName} status:`, {
          lastProcessedId: updated.lastProcessedId,
          isComplete: updated.isComplete,
          totalProcessed: updated.totalProcessed
        });

        if (!updated.isComplete) {
          const nextQuery = strat.createQuery(
            schema,
            entityName,
            updated.lastProcessedId ?? undefined,
            blockNumber,
            graphqlContext.pagination.maxRowsPerRequest
          );
          if (nextQuery) requests.push(nextQuery);
        } else {
          log.info(
            `No more queries needed for ${entityName}. Complete: ${updated.isComplete}, Last ID: ${updated.lastProcessedId}`
          );
        }

        if (data.length > 0) {
          const existingData = entityData[entityName] || [];
          entityData[entityName] = [...existingData, ...data];
        }

        log.info(`Processed ${updated.totalProcessed} records for ${entityName}`);
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

export { syncEntities };
