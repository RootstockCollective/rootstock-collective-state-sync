/**
 * New Proposal Strategy - Syncs new proposals from the governance subgraph.
 *
 * This strategy fetches proposals created within the voting period window
 * and syncs them along with related entities (Account, VoteCast).
 *
 * Implements BatchableStrategy for query batching optimization.
 */
import log from 'loglevel';

import { BatchableStrategy, ChangeStrategyParams, Proposal } from './types';
import { createEntityQuery } from '../../handlers/subgraphQueryBuilder';
import { executeRequests, GraphQLRequest, GraphQlContext } from '../../context/subgraphProvider';
import { syncEntities, processEntityData } from '../../handlers/subgraphSyncer';
import { getConfig } from '../../config/config';
import { EntityDataCollection } from '../../handlers/types';
import { AppContext } from '../../context/types';

/** Approximate number of blocks in a voting period on mainnet */
const VOTING_PERIOD_BLOCKS = 25000n;

/** Tracks the last block where this strategy ran to implement throttling */
let lastProcessedBlock = 0n;

/**
 * Determines if the strategy should run for the given block.
 * Implements throttling based on blockIntervalThreshold config.
 */
function shouldRun(blockNumber: bigint | null): boolean {
  if (!blockNumber) {
    return false;
  }

  const threshold = BigInt(getConfig().blockchain.blockIntervalThreshold);

  if (lastProcessedBlock > 0n && blockNumber < lastProcessedBlock + threshold) {
    log.debug(
      `[NewProposal] Skipping block ${blockNumber}, ` +
      `next run at block ${lastProcessedBlock + threshold}`
    );
    return false;
  }

  return true;
}

/**
 * Calculates the starting block for proposal queries.
 * Looks back one voting period to catch all active proposals.
 */
function getFromBlock(blockNumber: bigint): bigint {
  return blockNumber - VOTING_PERIOD_BLOCKS;
}

/**
 * Gets the GraphQL context for the Proposal entity's subgraph.
 */
function getSubgraphContext(appContext: AppContext): GraphQlContext | null {
  const proposalEntity = appContext.schema.entities.get('Proposal');
  if (!proposalEntity) {
    log.error('[NewProposal] Proposal entity not found in schema');
    return null;
  }

  const subgraphName = proposalEntity.subgraphProvider;
  return appContext.graphqlContexts[subgraphName] || null;
}

/**
 * Builds the GraphQL queries for fetching proposals.
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

  const fromBlock = getFromBlock(blockNumber);

  return [
    createEntityQuery(context.schema, 'Proposal', {
      first: graphqlContext.pagination.maxRowsPerRequest,
      order: { by: 'createdAtBlock', direction: 'desc' },
      filters: { createdAtBlock_gt: fromBlock }
    })
  ];
}

/**
 * Processes batch results - upserts proposals and syncs related entities.
 */
async function processBatchResults(
  results: EntityDataCollection,
  params: ChangeStrategyParams
): Promise<boolean> {
  const { context, blockNumber } = params;

  if (!blockNumber) {
    return false;
  }

  const proposals = (results['Proposal'] as Proposal[]) || [];

  if (proposals.length === 0) {
    log.debug('[NewProposal] No proposals found');
    return false;
  }

  log.info(`[NewProposal] Processing ${proposals.length} proposals`);

  // Upsert the proposals we received
  await processEntityData(context, { Proposal: proposals });

  // Sync related entities
  const relatedEntities = ['Account', 'VoteCast'].filter(
    name => context.schema.entities.has(name)
  );

  if (relatedEntities.length > 0) {
    await syncEntities(context, relatedEntities, getFromBlock(blockNumber));
  }

  lastProcessedBlock = blockNumber;
  return true;
}

/**
 * Standalone execution - used when not batching or as fallback.
 */
async function detectAndProcess(params: ChangeStrategyParams): Promise<boolean> {
  const { context, blockNumber } = params;

  if (!shouldRun(blockNumber) || !blockNumber) {
    return false;
  }

  const graphqlContext = getSubgraphContext(context);
  if (!graphqlContext) {
    return false;
  }

  const queries = await getQueries(params);
  if (queries.length === 0) {
    return false;
  }

  const results = await executeRequests(graphqlContext, queries);
  return processBatchResults(results, params);
}

/**
 * Creates a new instance of the NewProposal strategy.
 */
export function createNewProposalStrategy(): BatchableStrategy {
  return {
    name: 'NewProposal',
    canBatch: true,
    getSubgraphContext,
    getQueries,
    processBatchResults,
    detectAndProcess
  };
}
