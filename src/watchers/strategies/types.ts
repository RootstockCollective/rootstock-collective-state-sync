import { PublicClient } from 'viem';
import { AppContext } from '../../context/types';


export type ChangeStrategyParams = {
  context: AppContext;
  client: PublicClient;
}

export interface ChangeStrategy {
  name: string;
  detectAndProcess: (params: ChangeStrategyParams) => Promise<boolean>;
}

export interface BlockChangeLog {
  id: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  updatedEntities: string[];
}
