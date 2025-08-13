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

export type { BlockChangeLog, ChangeStrategy, ChangeStrategyParams };

