/**
 * Staking History Strategy - Syncs staking history and related accounts.
 *
 * This strategy fetches StakingHistory and Account entities that have changed
 * since the last sync, using the _change_block filter for incremental updates.
 *
 * Implements BatchableStrategy for query batching optimization.
 */
import log from 'loglevel';

import { BatchableStrategy, ChangeStrategyParams } from './types';
import { AppContext } from '../../context/types';
import { syncEntities, processEntityData } from '../../handlers/subgraphSyncer';
import { executeRequests, GraphQLRequest, GraphQlContext } from '../../context/subgraphProvider';
import { getConfig } from '../../config/config';
import { createEntityQueries } from '../../handlers/subgraphQueryBuilder';
import { EntityDataCollection } from '../../handlers/types';

/** Entities this strategy syncs */
const ENTITIES_TO_SYNC = ['Account', 'StakingHistory'] as const;

/** Tracks the last block where this strategy ran to implement throttling */
let lastProcessedBlock = 0n;

interface StakingHistoryRecord {
  blockNumber: string;
}

/**
 * Gets the last synced block from the StakingHistory table.
 */
async function getLastStoredBlock(db: AppContext['dbContext']['db']): Promise<bigint> {
  const result = await db<StakingHistoryRecord>('StakingHistory')
    .orderBy('blockNumber', 'desc')
    .first();

  return result?.blockNumber ? BigInt(result.blockNumber) : 0n;
}

/**
 * Determines if the strategy should run for the given block.
 */
function shouldRun(blockNumber: bigint | null): boolean {
  if (!blockNumber) {
    return false;
  }

  const threshold = BigInt(getConfig().blockchain.blockIntervalThreshold);

  if (lastProcessedBlock > 0n && blockNumber < lastProcessedBlock + threshold) {
    log.debug(
      `[StakingHistory] Skipping block ${blockNumber}, ` +
      `next run at block ${lastProcessedBlock + threshold}`
    );
    return false;
  }

  return true;
}

/**
 * Gets the starting block for queries (last stored + 1, or 0 if none).
 */
async function getFromBlock(context: AppContext): Promise<bigint> {
  const lastStoredBlock = await getLastStoredBlock(context.dbContext.db);
  return lastStoredBlock > 0n ? lastStoredBlock + 1n : 0n;
}

/**
 * Gets the GraphQL context for the StakingHistory entity's subgraph.
 */
function getSubgraphContext(appContext: AppContext): GraphQlContext | null {
  const entity = appContext.schema.entities.get('StakingHistory');
  if (!entity) {
    log.error('[StakingHistory] StakingHistory entity not found in schema');
    return null;
  }

  return appContext.graphqlContexts[entity.subgraphProvider] || null;
}

/**
 * Returns the valid entities to sync (those that exist in schema).
 */
function getValidEntities(context: AppContext): string[] {
  return ENTITIES_TO_SYNC.filter(name => context.schema.entities.has(name));
}

/**
 * Builds the GraphQL queries for fetching staking data.
 */
async function getQueries(params: ChangeStrategyParams): Promise<GraphQLRequest[]> {
  const { context, blockNumber } = params;

  if (!shouldRun(blockNumber) || !blockNumber) {
    return [];
  }

  const graphqlContext = getSubgraphContext(context);
  if (!graphqlContext) {
    return [];
  }

  const validEntities = getValidEntities(context);
  if (validEntities.length === 0) {
    return [];
  }

  const fromBlock = await getFromBlock(context);
  log.debug(`[StakingHistory] Building queries from block ${fromBlock}`);

  return createEntityQueries(context.schema, validEntities, {
    first: graphqlContext.pagination.maxRowsPerRequest,
    filters: { _change_block: { number_gte: fromBlock } }
  });
}

/**
 * Processes batch results - upserts data and handles pagination.
 */
async function processBatchResults(
  results: EntityDataCollection,
  params: ChangeStrategyParams
): Promise<boolean> {
  const { context, blockNumber } = params;

  if (!blockNumber) {
    return false;
  }

  const graphqlContext = getSubgraphContext(context);
  if (!graphqlContext) {
    return false;
  }

  const validEntities = getValidEntities(context);
  if (validEntities.length === 0) {
    return false;
  }

  // Step 1: Upsert initial batch results
  const batchData = extractEntityData(results, validEntities);
  if (Object.keys(batchData).length > 0) {
    log.info(`[StakingHistory] Processing ${countRecords(batchData)} records`);
    await processEntityData(context, batchData);
  }

  // Step 2: Handle pagination
  await handlePagination(context, graphqlContext, results, validEntities);

  lastProcessedBlock = blockNumber;
  return true;
}

/**
 * Extracts entity data from results for the specified entities.
 */
function extractEntityData(
  results: EntityDataCollection,
  entityNames: string[]
): EntityDataCollection {
  const data: EntityDataCollection = {};
  for (const name of entityNames) {
    if (results[name]?.length > 0) {
      data[name] = results[name];
    }
  }
  return data;
}

/**
 * Counts total records across all entities.
 */
function countRecords(data: EntityDataCollection): number {
  return Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
}

/**
 * Handles pagination for entities that returned max results.
 */
async function handlePagination(
  context: AppContext,
  graphqlContext: GraphQlContext,
  initialResults: EntityDataCollection,
  entityNames: string[]
): Promise<void> {
  const fromBlock = await getFromBlock(context);
  let pendingQueries = buildPaginationQueries(
    context, graphqlContext, initialResults, entityNames, fromBlock
  );

  while (pendingQueries.length > 0) {
    const pageResults = await executeRequests(graphqlContext, pendingQueries);
    await processEntityData(context, pageResults);

    pendingQueries = buildPaginationQueries(
      context, graphqlContext, pageResults, entityNames, fromBlock
    );
  }
}

/**
 * Builds pagination queries for entities that need more data.
 */
function buildPaginationQueries(
  context: AppContext,
  graphqlContext: GraphQlContext,
  results: EntityDataCollection,
  entityNames: string[],
  fromBlock: bigint
): GraphQLRequest[] {
  const queries: GraphQLRequest[] = [];
  const maxRows = graphqlContext.pagination.maxRowsPerRequest;

  for (const entityName of entityNames) {
    const data = results[entityName] || [];
    const needsPagination = data.length >= maxRows;
    const lastId = data[data.length - 1]?.id;

    if (needsPagination && lastId) {
      log.debug(`[StakingHistory] Paginating ${entityName} from id ${lastId}`);
      const nextQueries = createEntityQueries(context.schema, [entityName], {
        first: maxRows,
        filters: {
          id_gt: lastId,
          _change_block: { number_gte: fromBlock }
        }
      });
      queries.push(...nextQueries);
    }
  }

  return queries;
}

/**
 * Standalone execution - used when not batching or as fallback.
 */
async function detectAndProcess(params: ChangeStrategyParams): Promise<boolean> {
  const { context, blockNumber } = params;

  if (!shouldRun(blockNumber) || !blockNumber) {
    return false;
  }

  const validEntities = getValidEntities(context);
  if (validEntities.length === 0) {
    return false;
  }

  const fromBlock = await getFromBlock(context);
  log.info(`[StakingHistory] Syncing from block ${fromBlock}`);

  await syncEntities(context, validEntities, fromBlock);

  lastProcessedBlock = blockNumber;
  return true;
}

/**
 * Creates a new instance of the StakingHistory strategy.
 */
export function createStakingHistoryStrategy(): BatchableStrategy {
  return {
    name: 'StakingHistory',
    canBatch: true,
    getSubgraphContext,
    getQueries,
    processBatchResults,
    detectAndProcess
  };
}
