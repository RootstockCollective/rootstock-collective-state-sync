/**
 * Batch Executor - Orchestrates batched GraphQL query execution across strategies.
 *
 * This module groups queries from multiple BatchableStrategy instances by their
 * subgraph endpoint and executes them as single batched HTTP requests, reducing
 * network overhead.
 *
 * @example
 * ```typescript
 * const results = await executeBatchedStrategies(strategies, params);
 * // Results map: strategyName -> success/failure
 * ```
 */
import log from 'loglevel';

import { BatchableStrategy, ChangeStrategyParams } from './strategies/types';
import { executeRequests, GraphQlContext, GraphQLRequest } from '../context/subgraphProvider';
import { EntityDataCollection } from '../handlers/types';

/**
 * Represents a group of queries targeting the same subgraph endpoint.
 */
interface BatchGroup {
  graphqlContext: GraphQlContext;
  queries: QueryEntry[];
}

/**
 * A single query entry with its originating strategy.
 */
interface QueryEntry {
  strategy: BatchableStrategy;
  request: GraphQLRequest;
}

/**
 * Executes batched queries for multiple strategies, grouping by subgraph endpoint.
 *
 * @param strategies - Array of batchable strategies to execute
 * @param params - Execution parameters (context, client, blockNumber)
 * @returns Map of strategy names to their success/failure status
 */
export async function executeBatchedStrategies(
  strategies: BatchableStrategy[],
  params: ChangeStrategyParams
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  if (strategies.length === 0) {
    return results;
  }

  log.debug(`[BatchExecutor] Processing ${strategies.length} batchable strategies`);

  const batchGroups = await collectQueriesByEndpoint(strategies, params);

  for (const [endpoint, group] of batchGroups) {
    await processBatchGroup(endpoint, group, params, results);
  }

  return results;
}

/**
 * Collects queries from all strategies and groups them by subgraph endpoint.
 */
async function collectQueriesByEndpoint(
  strategies: BatchableStrategy[],
  params: ChangeStrategyParams
): Promise<Map<string, BatchGroup>> {
  const groups = new Map<string, BatchGroup>();

  for (const strategy of strategies) {
    try {
      const graphqlContext = strategy.getSubgraphContext(params.context);
      if (!graphqlContext) {
        log.warn(`[BatchExecutor] Strategy ${strategy.name} returned no subgraph context`);
        continue;
      }

      const queries = await strategy.getQueries(params);
      if (queries.length === 0) {
        log.debug(`[BatchExecutor] Strategy ${strategy.name} has no queries to execute`);
        continue;
      }

      addQueriesToGroup(groups, graphqlContext, strategy, queries);
    } catch (error) {
      log.error(`[BatchExecutor] Error collecting queries from ${strategy.name}:`, error);
    }
  }

  return groups;
}

/**
 * Adds queries from a strategy to the appropriate batch group.
 */
function addQueriesToGroup(
  groups: Map<string, BatchGroup>,
  graphqlContext: GraphQlContext,
  strategy: BatchableStrategy,
  queries: GraphQLRequest[]
): void {
  const endpoint = graphqlContext.endpoint;
  let group = groups.get(endpoint);

  if (!group) {
    group = { graphqlContext, queries: [] };
    groups.set(endpoint, group);
  }

  for (const request of queries) {
    group.queries.push({ strategy, request });
  }
}

/**
 * Processes a batch group - executes queries and routes results to strategies.
 */
async function processBatchGroup(
  endpoint: string,
  group: BatchGroup,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<void> {
  if (group.queries.length === 0) {
    return;
  }

  // Single query - no batching benefit, but still use batch infrastructure
  if (group.queries.length === 1) {
    await executeSingleQuery(group.queries[0], group.graphqlContext, params, results);
    return;
  }

  // Multiple queries - batch them
  const success = await executeBatchedQueries(endpoint, group, params, results);
  if (!success) {
    await executeFallback(group, params, results);
  }
}

/**
 * Executes a single query for a strategy.
 */
async function executeSingleQuery(
  entry: QueryEntry,
  graphqlContext: GraphQlContext,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<void> {
  try {
    const queryResults = await executeRequests(graphqlContext, [entry.request]);
    const success = await entry.strategy.processBatchResults(queryResults, params);
    results.set(entry.strategy.name, success);
  } catch (error) {
    log.error(`[BatchExecutor] Query failed for ${entry.strategy.name}:`, error);
    results.set(entry.strategy.name, false);
  }
}

/**
 * Executes multiple queries as a single batched request.
 */
async function executeBatchedQueries(
  endpoint: string,
  group: BatchGroup,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<boolean> {
  try {
    log.info(`[BatchExecutor] Batching ${group.queries.length} queries to ${endpoint}`);

    const requests = group.queries.map(q => q.request);
    const batchResults = await executeRequests(group.graphqlContext, requests);

    await routeResultsToStrategies(group.queries, batchResults, params, results);
    return true;
  } catch (error) {
    log.error(`[BatchExecutor] Batch failed for ${endpoint}:`, error);
    return false;
  }
}

/**
 * Routes batch results back to their respective strategies.
 */
async function routeResultsToStrategies(
  queries: QueryEntry[],
  batchResults: EntityDataCollection,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<void> {
  // Group queries by strategy to collect all entity names each strategy needs
  const strategyEntities = new Map<BatchableStrategy, Set<string>>();

  for (const { strategy, request } of queries) {
    let entities = strategyEntities.get(strategy);
    if (!entities) {
      entities = new Set();
      strategyEntities.set(strategy, entities);
    }
    entities.add(request.entityName);
  }

  // Process each strategy's results
  for (const [strategy, entityNames] of strategyEntities) {
    const strategyResults = extractResults(batchResults, entityNames);
    try {
      const success = await strategy.processBatchResults(strategyResults, params);
      results.set(strategy.name, success);
    } catch (error) {
      log.error(`[BatchExecutor] ${strategy.name} failed to process results:`, error);
      results.set(strategy.name, false);
    }
  }
}

/**
 * Extracts results for specific entity names from batch results.
 */
function extractResults(
  batchResults: EntityDataCollection,
  entityNames: Set<string>
): EntityDataCollection {
  const extracted: EntityDataCollection = {};
  for (const name of entityNames) {
    if (batchResults[name]) {
      extracted[name] = batchResults[name];
    }
  }
  return extracted;
}

/**
 * Fallback: executes queries individually when batching fails.
 */
async function executeFallback(
  group: BatchGroup,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<void> {
  log.warn('[BatchExecutor] Falling back to individual query execution');

  for (const entry of group.queries) {
    await executeSingleQuery(entry, group.graphqlContext, params, results);
  }
}
