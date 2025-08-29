// blockWatcher.ts
import log from 'loglevel';
import { PublicClient, type Block } from 'viem';

import { createClient } from '../client/createClient';
import { AppContext } from '../context/types';
import blockChangeLogStrategy from './strategies/blockChangeLogStrategy';
import { createRevertReorgsStrategy } from './strategies/reorgCleanupStrategy';
import { ChangeStrategy } from './strategies/types';


const createBlockHandlerWithStrategies = async (
  context: AppContext,
  client: PublicClient
) => {
  const strategies: ChangeStrategy[] = [
    createRevertReorgsStrategy(),
    blockChangeLogStrategy,
  ];

  return async (): Promise<void> => {
    // Run strategies sequentially to avoid race conditions on database updates
    let totalProcessed = 0;

    for (const strategy of strategies) {
      try {
        const processed = await strategy.detectAndProcess({
          context: context,
          client: client
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
  }
}

const watchBlocks = async (
  context: AppContext,
) => {

  const client = createClient(context.config);

  const handleBlockWithStrategies = await createBlockHandlerWithStrategies(context, client);

  return client.watchBlocks({
    onBlock: async (block: Block) => {
      log.info(`Processing block ${block.number}`);
      await handleBlockWithStrategies();
    },
    emitMissed: true,
    pollingInterval: 1000,
  });
}

export { watchBlocks };

