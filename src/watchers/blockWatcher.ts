/**
 * Block Watcher - Monitors new blocks and orchestrates strategy execution.
 *
 * This module watches for new blocks on the blockchain and runs various
 * strategies to sync data. Strategies that support batching are executed
 * together to reduce HTTP requests.
 */
import log from 'loglevel';
import { PublicClient, type Block } from 'viem';

import { createClient } from '../client/createClient';
import { AppContext } from '../context/types';
import { getRequestMetrics, getHttpMetrics } from '../context/subgraphProvider';
import blockChangeLogStrategy from './strategies/blockChangeLogStrategy';
import { createRevertReorgsStrategy } from './strategies/reorgCleanupStrategy';
import { ChangeStrategy, BatchableStrategy } from './strategies/types';
import {
  createNewProposalStrategy,
  createProposalStateStrategy,
  createStakingHistoryStrategy,
  createVaultHistoryStrategy,
} from './strategies';
import { executeBatchedStrategies } from './batchExecutor';

/**
 * Type guard to check if a strategy supports batching.
 */
function isBatchable(strategy: ChangeStrategy): strategy is BatchableStrategy {
  const batchable = strategy as BatchableStrategy;
  return batchable.canBatch === true &&
         typeof batchable.getSubgraphContext === 'function' &&
         typeof batchable.getQueries === 'function';
}

/**
 * Creates the block handler with all registered strategies.
 */
async function createBlockHandlerWithStrategies(
  context: AppContext,
  client: PublicClient
): Promise<(blockNumber: bigint | null) => Promise<void>> {
  const strategies: ChangeStrategy[] = [
    createRevertReorgsStrategy(),
    blockChangeLogStrategy,
    createNewProposalStrategy(),
    createProposalStateStrategy(),
    createStakingHistoryStrategy(),
    createVaultHistoryStrategy(),
  ];

  // Separate strategies by batching capability
  const batchableStrategies: BatchableStrategy[] = [];
  const individualStrategies: ChangeStrategy[] = [];

  for (const strategy of strategies) {
    if (isBatchable(strategy)) {
      batchableStrategies.push(strategy);
    } else {
      individualStrategies.push(strategy);
    }
  }

  return async (blockNumber: bigint | null): Promise<void> => {
    if (!blockNumber) {
      log.warn('[blockWatcher:handleBlock] No block number provided');
      return;
    }

    // Capture metrics before execution
    const metricsBefore = captureMetrics();

    // Execute batchable strategies together
    await executeBatchableStrategies(batchableStrategies, context, client, blockNumber);

    // Execute individual strategies
    await runStrategiesOneByOne(individualStrategies, context, client, blockNumber, 'non-batchable');

    // Log metrics summary
    logMetricsSummary(blockNumber, metricsBefore);
  };
}

/**
 * Captures current metrics state.
 */
function captureMetrics(): { requests: number; httpRequests: number } {
  return {
    requests: getRequestMetrics().totalRequests,
    httpRequests: getHttpMetrics().totalHttpRequests
  };
}

/**
 * Executes batchable strategies with fallback.
 */
async function executeBatchableStrategies(
  strategies: BatchableStrategy[],
  context: AppContext,
  client: PublicClient,
  blockNumber: bigint
): Promise<void> {
  if (strategies.length === 0) {
    return;
  }

  try {
    await executeBatchedStrategies(strategies, { context, client, blockNumber });
  } catch (error) {
    log.error('[blockWatcher:executeBatchableStrategies] Batch failed, using fallback:', error);
    await runStrategiesOneByOne(strategies, context, client, blockNumber, 'fallback');
  }
}

/**
 * Executes strategies one at a time (non-batched).
 * Used for strategies that don't support batching, or as fallback when batch fails.
 */
async function runStrategiesOneByOne(
  strategies: ChangeStrategy[],
  context: AppContext,
  client: PublicClient,
  blockNumber: bigint,
  reason: 'non-batchable' | 'fallback'
): Promise<void> {
  for (const strategy of strategies) {
    try {
      await strategy.detectAndProcess({ context, client, blockNumber });
    } catch (error) {
      const label = reason === 'fallback' ? 'fallback' : 'individual';
      log.error(`[blockWatcher:runStrategiesOneByOne] ${label} ${strategy.name} failed:`, error);
    }
  }
}

/**
 * Logs metrics summary for the block.
 */
function logMetricsSummary(
  blockNumber: bigint,
  before: { requests: number; httpRequests: number }
): void {
  const after = captureMetrics();
  const requests = after.requests - before.requests;
  const httpRequests = after.httpRequests - before.httpRequests;

  if (requests === 0) {
    return; // No activity this block
  }

  log.info(`[blockWatcher:logMetricsSummary] Block ${blockNumber}: ${requests} queries, ${httpRequests} HTTP`);

  // Log batching effectiveness only when there's a measurable benefit
  if (requests > 1 && httpRequests > 0 && httpRequests < requests) {
    const reduction = ((1 - httpRequests / requests) * 100).toFixed(0);
    log.info(`[blockWatcher:logMetricsSummary] Batching: ${reduction}% reduction (${requests} -> ${httpRequests})`);
  }
}

/**
 * Starts watching blocks and processing them with strategies.
 */
async function watchBlocks(context: AppContext): Promise<() => void> {
  const client = createClient(context.config);
  const handleBlock = await createBlockHandlerWithStrategies(context, client);

  return client.watchBlocks({
    onBlock: async (block: Block) => {
      log.debug(`[blockWatcher:watchBlocks] Processing block ${block.number}`);
      await handleBlock(block.number);
    },
    emitMissed: true,
    pollingInterval: 1000,
  });
}

export { watchBlocks, createBlockHandlerWithStrategies };
