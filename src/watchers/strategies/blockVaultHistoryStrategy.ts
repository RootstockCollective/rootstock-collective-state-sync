import { ChangeStrategy } from './types';
import { AppContext } from '../../context/types';
import { PublicClient } from 'viem';
import log from 'loglevel';
import { syncEntities } from '../../handlers/subgraphSyncer';
import { getConfig } from '../../config/config';

let LAST_PROCESSED_BLOCK = 0n;

interface VaultHistoryRecord {
  blockNumber: string;
}

const getLastVaultHistoryBlock = async (db: AppContext['dbContext']['db']): Promise<bigint> => {
  const result = await db<VaultHistoryRecord>('VaultHistory')
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
      log.error(
        'blockVaultHistoryStrategy->detectAndProcess: No block number provided, skipping processing',
      );
      return false;
    }

    const BLOCK_INTERVAL_THRESHOLD = BigInt(getConfig().blockchain.blockIntervalThreshold);

    // Check if current block is at least BLOCK_INTERVAL blocks after last processed block
    if (
      LAST_PROCESSED_BLOCK > 0n &&
      params.blockNumber < LAST_PROCESSED_BLOCK + BLOCK_INTERVAL_THRESHOLD
    ) {
      const blocksUntilNext = LAST_PROCESSED_BLOCK + BLOCK_INTERVAL_THRESHOLD - params.blockNumber;
      log.info(
        `blockVaultHistoryStrategy->detectAndProcess: Skipping block ${params.blockNumber}, not enough blocks since last processed (${LAST_PROCESSED_BLOCK}). Will process in ${blocksUntilNext} blocks`,
      );
      return false;
    }

    // Get the last block number from VaultHistory in the database
    // This ensures we only query new records since the last one we have
    const lastStoredBlock = await getLastVaultHistoryBlock(context.dbContext.db);
    const fromBlock = lastStoredBlock > 0n ? lastStoredBlock + 1n : 0n;
    log.info(
      `blockVaultHistoryStrategy->detectAndProcess: Last stored block: ${lastStoredBlock.toString()}, syncing vault history records from block ${fromBlock.toString()}`,
    );

    // Verify VaultHistory entity exists in schema
    const vaultHistoryEntity = context.schema.entities.get('VaultHistory');
    if (!vaultHistoryEntity) {
      log.error('VaultHistory entity not found in schema');
      return false;
    }

    // Sync VaultHistory
    // Since VaultHistory records are immutable (deposit/withdraw events), we only need to sync new ones
    const allEntitiesToSync = ['VaultHistory'];
    const validEntities = allEntitiesToSync.filter(entityName =>
      context.schema.entities.has(entityName),
    );

    if (validEntities.length > 0) {
      // Sync with fromBlock to only query new records from the subgraph
      await syncEntities(context, validEntities, fromBlock);

      // Update in-memory last processed block
      LAST_PROCESSED_BLOCK = params.blockNumber;

      log.info(
        `blockVaultHistoryStrategy->detectAndProcess: Synced vault history from block ${fromBlock.toString()}, stored last processed block: ${
          params.blockNumber
        }`,
      );

      return true;
    }

    return false;
  };

  const strategy = {
    name: 'VaultHistory',
    detectAndProcess,
  };
  return strategy;
};

export const createVaultHistoryStrategy = () => createStrategy();
