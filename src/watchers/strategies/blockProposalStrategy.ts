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
import { processEntityData } from '../../handlers/subgraphSyncer';
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
      `[blockProposalStrategy:shouldRun] Skipping block ${blockNumber}, ` +
      `next at ${lastProcessedBlock + threshold}`
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
    log.error('[blockProposalStrategy:getSubgraphContext] Proposal entity not found');
    return null;
  }

  const subgraphName = proposalEntity.subgraphProvider;
  return appContext.graphqlContexts[subgraphName] || null;
}

/**
 * Builds GraphQL queries for Proposal, Account, and VoteCast.
 * All queries are batched into a single HTTP request.
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
  const maxRows = graphqlContext.pagination.maxRowsPerRequest;

  return [
    createEntityQuery(context.schema, 'Proposal', {
      first: maxRows,
      order: { by: 'createdAtBlock', direction: 'desc' },
      filters: { createdAtBlock_gt: fromBlock }
    }),
    createEntityQuery(context.schema, 'Account', { first: maxRows }),
    createEntityQuery(context.schema, 'VoteCast', { first: maxRows })
  ];
}

/**
 * Processes batch results - upserts all entities from the batch.
 * No additional queries needed since Account and VoteCast are in the batch.
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
  const accounts = results['Account'] || [];
  const voteCasts = results['VoteCast'] || [];

  if (proposals.length === 0) {
    log.debug('[blockProposalStrategy:processBatchResults] No proposals found');
    return false;
  }

  const totalRecords = proposals.length + accounts.length + voteCasts.length;
  log.info(`[blockProposalStrategy:processBatchResults] ${totalRecords} records (${proposals.length} proposals)`);

  await processEntityData(context, {
    Proposal: proposals,
    Account: accounts,
    VoteCast: voteCasts
  });

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
