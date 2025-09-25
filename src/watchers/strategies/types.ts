import { PublicClient } from 'viem';
import { AppContext } from '../../context/types';


interface ChangeStrategyParams {
  context: AppContext;
  client: PublicClient;
  blockNumber: bigint | null;
}

interface ChangeStrategy {
  name: string;
  detectAndProcess: (params: ChangeStrategyParams) => Promise<boolean>;
}

export type BlockHash = string

interface BlockChangeLog {
  id: BlockHash;
  blockNumber: bigint;
  blockTimestamp: bigint;
  updatedEntities: string[];
}

interface LastProcessedBlock {
  id: Boolean; // there will only ever be one last processed block
  hash: BlockHash;
  number: bigint;
  timestamp: bigint;
}
interface Proposal {
  id: string;
  proposalId: string;
  voteStart: bigint;
  voteEnd: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  votesAbstains: bigint;
  quorum: bigint;
  state: string;
  rawState: number;
  createdAtBlock: bigint;
}

export type { ChangeStrategyParams, ChangeStrategy, BlockChangeLog, Proposal, LastProcessedBlock }
