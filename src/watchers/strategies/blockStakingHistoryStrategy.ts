import { ChangeStrategy } from './types';
import { AppContext } from '../../context/types';
import { PublicClient } from 'viem';
import log from 'loglevel';
import { syncEntities } from '../../handlers/subgraphSyncer';
import { getConfig } from '../../config/config';

let LAST_PROCESSED_BLOCK = 0n;

interface StakingHistoryRecord {
  blockNumber: string;
}

const getLastStakingHistoryBlock = async (
  db: AppContext['dbContext']['db']
): Promise<bigint> => {
  const result = await db<StakingHistoryRecord>('StakingHistory')
    .orderBy('blockNumber', 'desc')
    .first();

  if (!result || !result.blockNumber) {
    return 0n;
  }

  return BigInt(result.blockNumber);
};

const createStrategy = (): ChangeStrategy => {

  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
    blockNumber: bigint | null;
  }): Promise<boolean> => {
    const { context } = params;
    if (!params.blockNumber) {
      log.error('blockStakingHistoryStrategy->detectAndProcess: No block number provided, skipping processing');
      return false;
    }

    const BLOCK_INTERVAL_THRESHOLD = BigInt(getConfig().blockchain.blockIntervalThreshold);

    // Check if current block is at least BLOCK_INTERVAL blocks after last processed block
    if (LAST_PROCESSED_BLOCK > 0n && params.blockNumber < (LAST_PROCESSED_BLOCK + BLOCK_INTERVAL_THRESHOLD)) {
      const blocksUntilNext = (LAST_PROCESSED_BLOCK + BLOCK_INTERVAL_THRESHOLD) - params.blockNumber;
      log.info(`blockStakingHistoryStrategy->detectAndProcess: Skipping block ${params.blockNumber}, not enough blocks since last processed (${LAST_PROCESSED_BLOCK}). Will process in ${blocksUntilNext} blocks`);
      return false;
    }

    // Get the last block number from StakingHistory in the database
    // This ensures we only query new records since the last one we have
    const lastStoredBlock = await getLastStakingHistoryBlock(context.dbContext.db);
    const fromBlock = lastStoredBlock > 0n ? lastStoredBlock + 1n : 0n;
    log.info(`blockStakingHistoryStrategy->detectAndProcess: Last stored block: ${lastStoredBlock.toString()}, syncing staking history records from block ${fromBlock.toString()}`);

    // Verify StakingHistory entity exists in schema
    const stakingHistoryEntity = context.schema.entities.get('StakingHistory');
    if (!stakingHistoryEntity) {
      log.error('StakingHistory entity not found in schema');
      return false;
    }

    // Sync StakingHistory and Account (since StakingHistory has a relationship with Account)
    // Use fromBlock to only sync new records since the last processed block
    // Since StakingHistory records are immutable (transfer events), we only need to sync new ones
    const allEntitiesToSync = ['Account', 'StakingHistory'];
    const validEntities = allEntitiesToSync.filter(entityName => context.schema.entities.has(entityName));

    if (validEntities.length > 0) {
      // Sync with fromBlock to only query new records from the subgraph
      await syncEntities(context, validEntities, fromBlock);

      // Update in-memory last processed block
      LAST_PROCESSED_BLOCK = params.blockNumber;

      log.info(`blockStakingHistoryStrategy->detectAndProcess: Synced staking history from block ${fromBlock.toString()}, stored last processed block: ${params.blockNumber}`);

      return true;
    }

    return false;
  };

  const strategy = {
    name: 'StakingHistory',
    detectAndProcess
  };
  return strategy;
};

export const createStakingHistoryStrategy = () => createStrategy();

