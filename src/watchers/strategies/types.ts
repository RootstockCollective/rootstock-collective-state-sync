import { PublicClient } from 'viem';
import { AppContext } from '../../context/types';

export interface ChangeStrategy {
  name: string;
  detectChanges: (params: {
    context: AppContext;
    client: PublicClient;
  }) => Promise<{
    entities: string[];
    fromBlock: bigint;
  }>;
}

export interface EntityChange {
  entities: string[];
  blockNumber: bigint;
}

export interface BlockChangeLog {
  id: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  updatedEntities: string[];
}