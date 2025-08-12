import {ChangeStrategy, Proposal} from "./types";
import {AppContext} from "../../context/types";
import {Address, PublicClient} from "viem";
import {DatabaseContext} from "../../context/db";
import {GovernanceAbi} from "../../abis/GovernanceAbi";
import { CONTRACT_NAMES, getContractAddress } from "../../handlers/contracts";
import log from "loglevel";

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

const getProposals = async (
  dbContext: DatabaseContext
): Promise<Proposal[]> => {

  const { db } = dbContext;
  return db<Proposal>('Proposal').whereIn('rawState', 
    [ProposalState.Pending, ProposalState.Active, ProposalState.Succeeded, ProposalState.Queued]);
}

const getProposalStatesViaMulticall = async (
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
}

const getStateDescription = (rawState: number): string => {
  switch (rawState) {
    case ProposalState.Pending:
      return 'Pending';
    case ProposalState.Active:
      return 'Active';
    case ProposalState.Canceled:
      return 'Canceled';
    case ProposalState.Defeated:
      return 'Defeated';
    case ProposalState.Succeeded:
      return 'Succeeded';
    case ProposalState.Queued:
      return 'Queued';
    case ProposalState.Expired:
      return 'Expired';
    case ProposalState.Executed:
      return 'Executed';
    default:
      return 'Unknown';
  }
}

const createStrategy = (): ChangeStrategy => {

  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
    blockNumber: bigint | null;
  }): Promise<boolean> => {
    const { context, client, blockNumber } = params;
    const { dbContext } = context;
    const { db } = dbContext;

    const lastBlockNumber = blockNumber;
    const proposals = await getProposals(context.dbContext);
    if (proposals.length === 0) {
      return false;
    }

    // Get governance contract address from config
    const governanceAddress = getContractAddress(context.config, CONTRACT_NAMES.GOVERNOR);
    if (!governanceAddress) {
      log.error('Governance contract address not configured');
      return false;
    }

    const proposalIds = proposals.map(p => p.id);
    
    // Get real-time states from blockchain via multicall
    const stateMap = await getProposalStatesViaMulticall(client, governanceAddress, proposalIds);
    
    let updatedCount = 0;
    for (const proposal of proposals) {
      const { id, rawState } = proposal;
      const blockchainState = stateMap.get(proposal.id);
      
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

    log.info(`Updated ${updatedCount} proposals in block ${lastBlockNumber}`);

    return updatedCount > 0;
  }

  return {
    name: 'ProposalState',
    detectAndProcess
  };
}

export const createProposalStateStrategy = () => createStrategy();

