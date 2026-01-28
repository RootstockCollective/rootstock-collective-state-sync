// blockWatcher.ts
import log from 'loglevel';
import { PublicClient, type Block } from 'viem';

import { createClient } from '../client/createClient';
import { AppContext } from '../context/types';
import { ChangeStrategy } from './strategies/types';
import { blockChangeLogStrategy, revertReorgsStrategy, createNewProposalStrategy, createProposalStateStrategy, createStakingHistoryStrategy } from './strategies';
import { isReorgCleanupInProgress } from './strategies/reorgCleanupStrategy';


/**
 * Checks if block processing should be skipped
 * @returns Object with shouldProcess flag and reason if skipping
 */
const shouldProcessBlock = async (): Promise<{ shouldProcess: boolean; reason?: string }> => {
  // Check if reorg cleanup is running
  if (isReorgCleanupInProgress()) {
    return {
      shouldProcess: false,
      reason: 'reorg cleanup in progress'
    };
  }

  // Add other skip conditions here in the future (e.g., maintenance mode, manual pause, etc.)
  
  return { shouldProcess: true };
};

const createBlockHandlerWithStrategies = async (
  context: AppContext,
  client: PublicClient,
) => {
  const strategies: ChangeStrategy[] = [
    blockChangeLogStrategy(),
    createNewProposalStrategy(),
    createProposalStateStrategy(),
    createStakingHistoryStrategy(),
    revertReorgsStrategy(),
  ];

  return async (blockNumber: bigint | null): Promise<void> => {
    // Check if we should skip this block
    // Strategies process incrementally, so they will catch up on the next block
    const { shouldProcess, reason } = await shouldProcessBlock();
    if (!shouldProcess) {
      log.info(`Skipping block ${blockNumber} - ${reason}. Strategies will catch up on next block.`);
      return;
    }

    // Run strategies sequentially to avoid race conditions on database updates
    let totalProcessed = 0;

    for (const strategy of strategies) {
      try {
        const processed = await strategy.detectAndProcess({
          context: context,
          client: client,
          blockNumber
        });
        if (processed) {
          log.info(`Strategy ${strategy.name} processed changes successfully`);
          totalProcessed++;
        }
      } catch (error) {
        log.error(`Error in strategy ${strategy.name}:`, error);
        // Continue with next strategy even if this one fails
      }
    }

    if (totalProcessed > 0) {
      log.info(`Processed changes from ${totalProcessed} strategies`);
    }
  };
};

const watchBlocks = async (
  context: AppContext,
) => {

  const client = createClient(context.config);

  const handleBlockWithStrategies = await createBlockHandlerWithStrategies(context, client);

  return client.watchBlocks({
    onBlock: async (block: Block) => {
      log.info(`Processing block ${block.number}`);
      await handleBlockWithStrategies(block.number);
    },
    emitMissed: true,
    pollingInterval: 1000,
  });
};

export { watchBlocks };

