import { PublicClient } from 'viem';
import { BlockChangeLog, ChangeStrategy } from './types';
import { createEntityQuery } from '../../handlers/queryBuilder';
import { executeRequests } from '../../context/theGraph';
import { TheGraphContext } from '../../context/theGraph';  
import { DatabaseSchema } from '../../handlers/types';
import { AppContext } from '../../context/types';


const createStrategy = (lastProcessedBlock: BlockChangeLog): ChangeStrategy => {
  const detectChanges = async (params: {
    context: AppContext;
    client: PublicClient;
  }): Promise<{
    entities: string[];
    fromBlock: bigint;
  }> => {
    const { context, client } = params;
    const fromBlock = lastProcessedBlock.blockNumber;

    // Query all block change logs since the last processed block
    const query = createEntityQuery(context.schema, 'BlockChangeLog', {
      first: 1000,
      order: {
        by: 'blockNumber',
        direction: 'desc'
      },
      filters: {
        blockNumber_gte: fromBlock
      }
    });

    const results = await executeRequests(context.graphqlContext, [query]);

    const blockChangeLogResults: BlockChangeLog[] = results.get('BlockChangeLog') || [];

    if(blockChangeLogResults.pop()?.id === lastProcessedBlock.id) {
      return {
        entities: [],
        fromBlock: fromBlock
      };
    }

    // Get all unique entities that were updated in any of these blocks
    const uniqueEntities = new Set<string>(
      blockChangeLogResults.flatMap(result => result.updatedEntities || [])
    );

  
    return {
      entities: Array.from(uniqueEntities),
      fromBlock: fromBlock
    };
  };

  return {
    name: 'BlockChangeLog',
    detectChanges
  };
};

export const createBlockChangeLogStrategy = (lastProcessedBlock: BlockChangeLog) => createStrategy(lastProcessedBlock); 