// blockWatcher.ts
import { PublicClient, type Block } from 'viem'
import log from 'loglevel';

import { BlockChangeLog, ChangeStrategy, EntityChange } from './strategies/types';
import { createBlockChangeLogStrategy } from './strategies/blockChangeLogStrategy';
import { DatabaseContext } from '../context/db';
import { AppContext } from '../context/types';

// Pure function to get the last processed block from the database
const getLastProcessedBlock = async (
  dbContext: DatabaseContext
  ): Promise<BlockChangeLog> => {
  const client = await dbContext.pool.connect();
  try {
    const result = await client.query(
      'SELECT id, "blockNumber", "blockTimestamp", "updatedEntities" FROM "BlockChangeLog" ORDER BY "blockNumber" DESC LIMIT 1'
    );
    const lastBlock = result.rows[0];
    return lastBlock ? {
      id: lastBlock.id,
      blockNumber: BigInt(lastBlock.blockNumber),
      blockTimestamp: BigInt(lastBlock.blockTimestamp),
      updatedEntities: lastBlock.updatedEntities
    } : {
      id: '',
      blockNumber: BigInt(0),
      blockTimestamp: BigInt(0),
      updatedEntities: []
    };
  } finally {
    client.release();
  }
};

const createBlockHandler = async (
  context: AppContext,
  client: PublicClient
) => {
  const lastProcessedBlock = await getLastProcessedBlock(context.dbContext);
  
  const strategies: ChangeStrategy[] = [
    createBlockChangeLogStrategy(lastProcessedBlock),
  ];

  return async (): Promise<EntityChange | null> => {    
    // Run all strategies in parallel
    const strategyResults = await Promise.all(
      strategies.map(strategy =>  
        strategy.detectChanges({
          context: context,
          client: client
        })
      )
    );

    // Combine and deduplicate results from all strategies
    const changedEntities = Array.from(
      new Set(strategyResults.flatMap(result => result.entities))
    );

    if (changedEntities.length === 0) return null;

    // Use the earliest fromBlock from any strategy that found changes
    const fromBlock = strategyResults
      .filter(result => result.entities.length > 0)
      .reduce((earliest, result) => 
        result.fromBlock < earliest ? result.fromBlock : earliest,
        BigInt(Number.MAX_SAFE_INTEGER)
      );

    return {
      entities: [...changedEntities, 'BlockChangeLog'],
      blockNumber: fromBlock
    };
  };
};

export const watchBlocks = async (
  context: AppContext,
  client: PublicClient, 
  onEntityChange: (change: EntityChange) => Promise<void>
) => {

  const handleBlock = await createBlockHandler(context, client);

  return client.watchBlocks({
    onBlock: async (block: Block) => {
      log.info(`Processing block ${block.number}`);

      const change = await handleBlock();
      if (change) {
        await onEntityChange(change);
      }
    },
    emitMissed: true,
    pollingInterval: 1000,
  });
}