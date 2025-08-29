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

interface Proposal {
  id: string;
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

export type { ChangeStrategyParams, ChangeStrategy, BlockChangeLog, Proposal }
