
import { BlockChangeLog, ChangeStrategy } from './types';
import { createEntityQuery } from '../../handlers/queryBuilder';
import { executeRequests } from '../../context/theGraph';
import { AppContext } from '../../context/types';
import { getLastProcessedBlock } from '../blockWatcher';

const createStrategy = (): ChangeStrategy => {

  const detectChanges = async (params: {
    context: AppContext;
  }): Promise<{
    entities: string[];
    fromBlock: bigint;
  }> => {
    const { context } = params;
    
    const lastProcessedBlock = await getLastProcessedBlock(context.dbContext);
    const fromBlock = BigInt(lastProcessedBlock.blockNumber);

    // Query all block change logs since the last processed block
    const query = createEntityQuery(context.schema, 'BlockChangeLog', {
      first: context.graphqlContext.pagination.maxRowsPerRequest,
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

    if(blockChangeLogResults[0]?.id === lastProcessedBlock.id.toString()) {
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

export const createBlockChangeLogStrategy = () => createStrategy(); 