import { PublicClient } from 'viem';
import { BlockChangeLog, ChangeStrategy } from './types';
import { createEntityQuery } from '../../handlers/subgraphQueryBuilder';
import { executeRequests } from '../../context/subgraphProvider';
import { AppContext } from '../../context/types';
import { syncEntities } from '../../handlers/subgraphSyncer';
import log from 'loglevel';
import { DatabaseContext } from '../../context/db';


const getLastProcessedBlock = async (
  dbContext: DatabaseContext
): Promise<BlockChangeLog> => {

  const { db } = dbContext;

  const result = await db<BlockChangeLog>('BlockChangeLog').orderBy('blockNumber', 'desc').limit(1);
  if (result.length === 0) {
    return {
      id: '0x00',
      blockNumber: BigInt(0),
      blockTimestamp: BigInt(0),
      updatedEntities: []
    }
  }

  return result[0];
}

const createStrategy = (): ChangeStrategy => {

  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
  }): Promise<boolean> => {
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
      log.info(`${strategy.name}: No new changes since last processed block`);
      return false;
    }

    // Get all unique entities that were updated in any of these blocks
    const uniqueEntities = new Set<string>(
      blockChangeLogResults.flatMap(result => result.updatedEntities || [])
    );

    const entitiesToSync = Array.from(uniqueEntities);
    
    if (entitiesToSync.length === 0) {
      log.info(`${strategy.name}: No entities to sync`);
      return false;
    }

    // Process the changes specific to this strategy
    log.info(`${strategy.name}: Processing ${entitiesToSync.length} entities: ${entitiesToSync.join(', ')}`);
    
    // Add BlockChangeLog itself to the entities to sync
    const allEntitiesToSync = [...entitiesToSync, 'BlockChangeLog'];
    const validEntities = allEntitiesToSync.filter(entityName => context.schema.entities.has(entityName));
    
    if (validEntities.length > 0) {
      await syncEntities(context, validEntities, fromBlock);
      return true;
    }

    return false;
  }

  const strategy = {
    name: 'BlockChangeLog',
    detectAndProcess
  }

  return strategy;
}

export const createBlockChangeLogStrategy = () => createStrategy(); 
