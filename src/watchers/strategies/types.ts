import { PublicClient } from 'viem';
import { AppContext } from '../../context/types';


interface ChangeStrategyParams {
  context: AppContext;
  client: PublicClient;
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

export type { BlockChangeLog, ChangeStrategy, ChangeStrategyParams, LastProcessedBlock };

