import { ChangeStrategy } from './types';
import { AppContext } from '../../context/types';
import { PublicClient } from 'viem';
import { CONTRACT_NAMES, getContractAddress } from '../../handlers/contracts';
import log from 'loglevel';
import { getProposals, updateProposals } from './shared/proposalStateHelpers';

/**
 * Strategy for checking and updating proposal states for old proposals (older than one week).
 * Runs periodically (every N blocks) to catch state changes in proposals that are no longer
 * actively monitored by the recent proposal strategy.
 */
const createStrategy = (): ChangeStrategy => {
  let LAST_OLD_PROPOSALS_CHECK_BLOCK = 0n;

  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
    blockNumber: bigint | null;
  }): Promise<boolean> => {
    const { context, client, blockNumber } = params;
    const { dbContext } = context;
    
    if (!blockNumber) {
      log.debug('oldProposalStateStrategy->detectAndProcess: No block number provided, skipping processing');
      return false;
    }

    // Get governance contract address from config
    const governanceAddress = getContractAddress(context.config, CONTRACT_NAMES.GOVERNOR);
    if (!governanceAddress) {
      log.error('oldProposalStateStrategy: Governance contract address not configured');
      return false;
    }

    const oldProposalCheckIntervalBlocks = BigInt(
      context.config.blockchain.oldProposalCheckIntervalBlocks ?? 15
    );
    const blocksPerWeek = BigInt(context.config.blockchain.blocksPerWeek ?? 20160);

    // Check if we should run the old proposals check based on interval
    const shouldCheckOldProposals = LAST_OLD_PROPOSALS_CHECK_BLOCK === 0n ||
      blockNumber >= (LAST_OLD_PROPOSALS_CHECK_BLOCK + oldProposalCheckIntervalBlocks);

    if (!shouldCheckOldProposals) {
      return false;
    }

    // Calculate one week ago in blocks
    const oneWeekAgoBlock = blockNumber - blocksPerWeek;
    
    // Get old proposals (created before one week ago)
    const oldProposals = await getProposals(dbContext, {
      maxAgeBlock: oneWeekAgoBlock
    });

    if (oldProposals.length === 0) {
      LAST_OLD_PROPOSALS_CHECK_BLOCK = blockNumber;
      log.debug(`oldProposalStateStrategy: No old proposals to check (created before block ${oneWeekAgoBlock.toString()})`);
      return false;
    }

    log.info(`oldProposalStateStrategy: Checking ${oldProposals.length} old proposals (created before block ${oneWeekAgoBlock.toString()})`);

    const updatedCount = await updateProposals(
      oldProposals,
      client,
      governanceAddress,
      dbContext,
      blockNumber
    );

    LAST_OLD_PROPOSALS_CHECK_BLOCK = blockNumber;
    log.debug(`oldProposalStateStrategy: Next check will be at block ${(blockNumber + oldProposalCheckIntervalBlocks).toString()}`);

    return updatedCount > 0;
  };

  return {
    name: 'OldProposalState',
    detectAndProcess
  };
};

export const createOldProposalStateStrategy = () => createStrategy();

