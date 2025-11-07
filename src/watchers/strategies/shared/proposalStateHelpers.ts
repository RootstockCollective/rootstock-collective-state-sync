import { Address, PublicClient } from 'viem';
import { DatabaseContext } from '../../../context/db';
import { GovernanceAbi } from '../../../abis/GovernanceAbi';
import log from 'loglevel';
import { Proposal } from '../types';

export enum ProposalState {
  Pending,
  Active,
  Canceled,
  Defeated,
  Succeeded,
  Queued,
  Expired,
  Executed,
}

export interface GetProposalsOptions {
  maxAgeBlock?: bigint;
}

/**
 * Gets proposals from the database that are in pending states.
 * Optionally filters by age (createdAtBlock < maxAgeBlock).
 */
export const getProposals = async (
  dbContext: DatabaseContext,
  options?: GetProposalsOptions
): Promise<Proposal[]> => {
  const { db } = dbContext;
  const pendingStates = [
    ProposalState.Succeeded, 
    ProposalState.Queued
  ];

  let query = db<Proposal>('Proposal').whereIn('rawState', pendingStates);

  if (options?.maxAgeBlock !== undefined) {
    query = query.where('createdAtBlock', '<', options.maxAgeBlock.toString());
  }

  return query;
};

/**
 * Fetches proposal states from the blockchain via multicall.
 */
export const getProposalStatesViaMulticall = async (
  client: PublicClient,
  governanceAddress: string,
  proposalIds: string[]
): Promise<Map<string, number>> => {
  const stateMap = new Map<string, number>();
  
  if (proposalIds.length === 0) {
    return stateMap;
  }

  try {
    // Create multicall calls for each proposal's state
    const calls = proposalIds.map(proposalId => ({
      address: governanceAddress as Address,
      abi: GovernanceAbi,
      functionName: 'state',
      args: [BigInt(proposalId)] as const,
    }));

    // Execute multicall
    const results = await client.multicall({
      contracts: calls,
    });

    // Map results back to proposal IDs
    proposalIds.forEach((proposalId, index) => {
      const result = results[index];
      if (!result) {
        log.warn(`No result returned for proposal ${proposalId} at index ${index} (expected ${proposalIds.length} results, got ${results.length})`);
        return;
      }
      if (result.status === 'success') {
        stateMap.set(proposalId, Number(result.result));
      } else {
        log.warn(`Failed to get state for proposal ${proposalId}: ${result.error}`);
      }
    });

  } catch (error) {
    log.error('Error executing multicall for proposal states:', error);
  }

  return stateMap;
};

const stateDescriptions: Record<ProposalState, string> = {
  [ProposalState.Pending]: 'Pending',
  [ProposalState.Active]: 'Active',
  [ProposalState.Canceled]: 'Canceled',
  [ProposalState.Defeated]: 'Defeated',
  [ProposalState.Succeeded]: 'Succeeded',
  [ProposalState.Queued]: 'Queued',
  [ProposalState.Expired]: 'Expired',
  [ProposalState.Executed]: 'Executed',
};

/**
 * Converts a raw proposal state number to its string description.
 */
export const getStateDescription = (rawState: ProposalState): string => {
  return stateDescriptions[rawState] ?? 'Unknown';
};

/**
 * Updates proposals in the database with their current blockchain state.
 * Returns the number of proposals that were updated.
 */
export const updateProposals = async (
  proposals: Proposal[],
  client: PublicClient,
  governanceAddress: string,
  dbContext: DatabaseContext,
  blockNumber: bigint | null
): Promise<number> => {
  if (proposals.length === 0) {
    return 0;
  }

  const { db } = dbContext;
  const proposalIds = proposals.map(p => p.proposalId);
  
  // Get real-time states from blockchain via multicall
  const stateMap = await getProposalStatesViaMulticall(client, governanceAddress, proposalIds);
  
  let updatedCount = 0;
  for (const proposal of proposals) {
    const { id, rawState } = proposal;
    const blockchainState = stateMap.get(proposal.proposalId);
    
    if (blockchainState !== undefined && blockchainState !== rawState) {
      const stateDescription = getStateDescription(blockchainState);
      
      await db<Proposal>('Proposal').where('id', id).update({
        rawState: blockchainState,
        state: stateDescription,
      });
      
      log.debug(`Updated proposal ${id} state from ${rawState} to ${blockchainState} (${stateDescription})`);
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    log.info(`Updated ${updatedCount} proposals in block ${blockNumber}`);
  }

  return updatedCount;
};

