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

interface BlockChangeLog {
  id: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  updatedEntities: string[];
}

export type { ChangeStrategyParams, ChangeStrategy, BlockChangeLog }
