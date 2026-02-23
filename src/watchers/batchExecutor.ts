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

import { getMetadataRequest, getSubgraphName } from './batchMetadata';
import { BatchableStrategy, ChangeStrategyParams } from './strategies/types';
import {
  executeRequests,
  GraphQlContext,
  GraphQLMetadata,
  GraphQLRequest,
} from '../context/subgraphProvider';
import { AppContext } from '../context/types';
import { saveSubgraphMetadata } from '../handlers/subgraphMetadata';
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

  log.debug(`[batchExecutor:executeBatchedStrategies] Processing ${strategies.length} strategies`);

  const { groups: batchGroups, failed } = await groupQueriesByEndpoint(strategies, params);

  // Mark failed strategies
  for (const name of failed) {
    results.set(name, false);
  }

  for (const [endpoint, group] of batchGroups) {
    await processBatchGroup(endpoint, group, params, results);
  }

  return results;
}

/**
 * Collects queries from strategies and groups them by endpoint.
 * 
 * Example: Two strategies targeting the same subgraph get grouped together:
 *   Input:  [ProposalStrategy, StakingStrategy] both → governance subgraph
 *   Output: Map { "https://api.thegraph.com/governance" → { queries: [...], strategies: [...] } }
 * 
 * @returns Map of endpoint URL → batch group, plus list of failed strategies
 */
async function groupQueriesByEndpoint(
  strategies: BatchableStrategy[],
  params: ChangeStrategyParams
): Promise<{ groups: Map<string, BatchGroup>; failed: string[] }> {
  const groups = new Map<string, BatchGroup>();
  const failed: string[] = [];

  for (const strategy of strategies) {
    try {
      const graphqlContext = strategy.getSubgraphContext(params.context);
      if (!graphqlContext) {
        log.warn(`[batchExecutor:groupQueriesByEndpoint] ${strategy.name} has no subgraph context`);
        failed.push(strategy.name);
        continue;
      }

      const queries = await strategy.getQueries(params);
      if (queries.length === 0) {
        log.debug(`[batchExecutor:groupQueriesByEndpoint] ${strategy.name} has no queries`);
        continue;
      }

      addToEndpointGroup(groups, graphqlContext, strategy, queries);
    } catch (error) {
      log.error(`[batchExecutor:groupQueriesByEndpoint] ${strategy.name} failed:`, error);
      failed.push(strategy.name);
    }
  }

  return { groups, failed };
}

/**
 * Adds queries to the batch group for their endpoint.
 * Creates a new group if one doesn't exist for that endpoint.
 */
function addToEndpointGroup(
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
 * Resolves subgraph name once and passes it to single/batched paths so metadata logic can use it without re-resolving.
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

  const subgraphName = getSubgraphName(params.context, group.graphqlContext);

  // Single query - no batching benefit, but still use batch infrastructure
  if (group.queries.length === 1) {
    await executeSingleQuery(
      group.queries[0],
      group.graphqlContext,
      params,
      results,
      subgraphName
    );
    return;
  }

  // Multiple queries - batch them
  const success = await executeBatchedQueries(
    endpoint,
    group,
    params,
    results,
    subgraphName
  );
  if (!success) {
    await executeFallback(group, params, results);
  }
}

/**
 * Builds the request list for a single-query execution, optionally appending one metadata request.
 * To remove metadata from single-query path later, replace the call with:
 * { requests: [entry.request], subgraphName: undefined }.
 * @param subgraphName - When provided (e.g. from processBatchGroup or executeFallback), avoids re-resolving.
 */
function buildRequestsWithOptionalMetadataForSingle(
  entry: QueryEntry,
  graphqlContext: GraphQlContext,
  params: ChangeStrategyParams,
  subgraphName?: string | undefined
): { requests: GraphQLRequest[]; subgraphName: string | undefined } {
  const resolvedSubgraphName =
    subgraphName ?? getSubgraphName(params.context, graphqlContext);
  const metadataRequest =
    resolvedSubgraphName !== undefined
      ? getMetadataRequest(
        params.context,
        resolvedSubgraphName,
        new Set([entry.request.entityName])
      )
      : null;

  const requests: GraphQLRequest[] = [entry.request];
  if (metadataRequest !== null) {
    requests.push(metadataRequest);
  }
  return { requests, subgraphName: resolvedSubgraphName };
}

/**
 * Executes a single query for a strategy.
 * When the schema defines SubgraphMetadata, includes one metadata request in the same HTTP call and persists _meta.
 * @param subgraphName - When provided by the caller (processBatchGroup or executeFallback), avoids duplicate resolution.
 */
async function executeSingleQuery(
  entry: QueryEntry,
  graphqlContext: GraphQlContext,
  params: ChangeStrategyParams,
  results: Map<string, boolean>,
  subgraphName?: string | undefined
): Promise<void> {
  try {
    const { requests, subgraphName: resolvedSubgraphName } =
      buildRequestsWithOptionalMetadataForSingle(
        entry,
        graphqlContext,
        params,
        subgraphName
      );
    const queryResults = await executeRequests(graphqlContext, requests);
    await persistMetadataFromBatchResult(
      params.context,
      resolvedSubgraphName,
      queryResults
    );

    const strategyResults = extractResults(
      queryResults,
      new Set([entry.request.entityName])
    );
    const success = await entry.strategy.processBatchResults(strategyResults, params);
    results.set(entry.strategy.name, success);
  } catch (error) {
    log.error(`[BatchExecutor] Query failed for ${entry.strategy.name}:`, error);
    results.set(entry.strategy.name, false);
  }
}

/**
 * Builds the request list for a batch group, optionally appending one metadata request
 * when the schema defines SubgraphMetadata. To remove metadata from batching later,
 * replace the call with: { requests: group.queries.map(q => q.request), subgraphName: undefined }.
 * @param subgraphName - When provided by the caller (processBatchGroup), avoids re-resolving.
 */
function buildRequestsWithOptionalMetadata(
  group: BatchGroup,
  params: ChangeStrategyParams,
  subgraphName?: string | undefined
): { requests: GraphQLRequest[]; subgraphName: string | undefined } {
  const resolvedSubgraphName =
    subgraphName ?? getSubgraphName(params.context, group.graphqlContext);
  const existingEntityNames = new Set(group.queries.map(q => q.request.entityName));
  const metadataRequest =
    resolvedSubgraphName !== undefined
      ? getMetadataRequest(
        params.context,
        resolvedSubgraphName,
        existingEntityNames
      )
      : null;

  const requests = group.queries.map(q => q.request);
  if (metadataRequest !== null) {
    requests.push(metadataRequest);
  }
  return { requests, subgraphName: resolvedSubgraphName };
}

/**
 * If the batch result contains _meta for the given subgraph, persists it via saveSubgraphMetadata.
 * To remove metadata persistence later, delete the call to this function from executeBatchedQueries.
 */
async function persistMetadataFromBatchResult(
  context: AppContext,
  subgraphName: string | undefined,
  batchResults: EntityDataCollection
): Promise<void> {
  if (
    subgraphName === undefined ||
    !('_meta' in batchResults) ||
    batchResults._meta === undefined
  ) {
    return;
  }
  await saveSubgraphMetadata(
    context,
    subgraphName,
    batchResults._meta as unknown as GraphQLMetadata
  );
}

/**
 * Executes multiple queries as a single batched request.
 * @param subgraphName - When provided by processBatchGroup, avoids re-resolving for metadata.
 */
async function executeBatchedQueries(
  endpoint: string,
  group: BatchGroup,
  params: ChangeStrategyParams,
  results: Map<string, boolean>,
  subgraphName?: string | undefined
): Promise<boolean> {
  try {
    log.info(`[BatchExecutor] Batching ${group.queries.length} queries to ${endpoint}`);

    const { requests, subgraphName: resolvedSubgraphName } =
      buildRequestsWithOptionalMetadata(group, params, subgraphName);
    const batchResults = await executeRequests(group.graphqlContext, requests);
    await persistMetadataFromBatchResult(
      params.context,
      resolvedSubgraphName,
      batchResults
    );

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
 * Resolves subgraph name once and passes it to each executeSingleQuery (metadata is still requested and saved per call).
 */
async function executeFallback(
  group: BatchGroup,
  params: ChangeStrategyParams,
  results: Map<string, boolean>
): Promise<void> {
  log.warn('[BatchExecutor] Falling back to individual query execution');

  const subgraphName = getSubgraphName(params.context, group.graphqlContext);
  for (const entry of group.queries) {
    await executeSingleQuery(
      entry,
      group.graphqlContext,
      params,
      results,
      subgraphName
    );
  }
}
