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
import { runReorgGate } from './strategies/reorgCleanupStrategy';
import { ChangeStrategy, BatchableStrategy } from './strategies/types';
import { withSharedReorgLock } from '../handlers/schema';
import {
  createNewProposalStrategy,
  createProposalStateStrategy,
  createStakingHistoryStrategy,
  createBtcVaultHistoryStrategy,
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
    blockChangeLogStrategy,
    createNewProposalStrategy(),
    createProposalStateStrategy(),
    createStakingHistoryStrategy(),
    createBtcVaultHistoryStrategy(),
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

    // Reorg gate decides whether the rest of this tick should run. When any
    // session is rebuilding public, writes from other strategies would be
    // dropped by the upcoming switchSchema, so we skip them here.
    let shouldSkipRest = false;
    try {
      const gate = await runReorgGate({ context, client });
      shouldSkipRest = gate.skipRest;
    } catch (error) {
      log.error('[blockWatcher:handleBlock] Reorg gate failed, skipping this block:', error);
      return;
    }

    if (shouldSkipRest) {
      log.info(`[blockWatcher:handleBlock] Skipping block ${blockNumber}: reorg cleanup in progress`);
      return;
    }

    // Hold a shared advisory lock for the duration of strategy execution so a
    // rebuild on any replica cannot call switchSchema while these writes are
    // in flight. The lock-holder transaction does no writes itself; strategies
    // continue to write through other pool connections as before.
    const lockOutcome = await withSharedReorgLock(context.dbContext, async () => {
      const metricsBefore = captureMetrics();
      await executeBatchableStrategies(batchableStrategies, context, client, blockNumber);
      await runStrategiesOneByOne(individualStrategies, context, client, blockNumber, 'non-batchable');
      logMetricsSummary(blockNumber, metricsBefore);
    });

    if (!lockOutcome.acquired) {
      log.info(`[blockWatcher:handleBlock] Skipping block ${blockNumber}: rebuild in progress, shared lock unavailable`);
    }
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

  // Coalesce onBlock callbacks: when ticks are slow, multiple new blocks may
  // arrive before the current tick finishes. Strategies are cursor-driven, so
  // running one tick at the latest head catches up everything in between.
  // We keep a single-slot "pending block" — newer arrivals overwrite older
  // pending ones — and a `running` flag so only one tick executes at a time.
  let pendingBlock: bigint | null = null;
  let running = false;
  let lastTickedBlock: bigint | null = null;

  const drain = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      while (pendingBlock !== null) {
        const blockNumber = pendingBlock;
        pendingBlock = null;

        const coalesced = lastTickedBlock !== null && blockNumber > lastTickedBlock + 1n
          ? blockNumber - lastTickedBlock - 1n
          : 0n;
        const suffix = coalesced > 0n ? ` (coalesced ${coalesced} intermediate block(s))` : '';
        log.info(`[blockWatcher:watchBlocks] Processing block ${blockNumber}${suffix}`);

        try {
          await handleBlock(blockNumber);
        } catch (error) {
          log.error(`[blockWatcher:watchBlocks] Block ${blockNumber} failed:`, error);
        }
        lastTickedBlock = blockNumber;
      }
    } finally {
      running = false;
    }
  };

  return client.watchBlocks({
    onBlock: (block: Block) => {
      if (block.number === null) {
        return;
      }
      if (pendingBlock === null || block.number > pendingBlock) {
        pendingBlock = block.number;
      }
      void drain();
    },
    emitMissed: true,
    pollingInterval: 1000,
  });
}

export { watchBlocks, createBlockHandlerWithStrategies };
