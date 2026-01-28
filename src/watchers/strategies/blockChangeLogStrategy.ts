import log from 'loglevel';
import { PublicClient } from 'viem';
import { executeRequests } from '../../context/subgraphProvider';
import { AppContext } from '../../context/types';
import { isIgnorableEntity } from '../../utils/entityUtils';
import { createEntityQuery } from '../../handlers/subgraphQueryBuilder';
import { syncEntities } from '../../handlers/subgraphSyncer';
import { EntityDataCollection, WithMetadata } from '../../handlers/types';
import { BlockChangeLog, ChangeStrategy, LastProcessedBlock } from './types';
import { getLastProcessedBlock, trackEntityIds } from './utils';
import { pruneOldEntityChangeLog } from './reorgCleanupStrategy';

const STRATEGY_NAME = 'blockChangeLogStrategy';
const schemaName = 'BlockChangeLog';

export const blockChangeLogStrategy = (): ChangeStrategy => {
  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
  }): Promise<boolean> => {
    const { context } = params;

    const { blockNumber: lastStoredBlockNumber, id: lastStoredBlockHash } = await getLastProcessedBlock(context.dbContext.db);
    const fromBlock = BigInt(lastStoredBlockNumber);

    const subgraphName = context.schema.entities.get(schemaName)?.subgraphProvider;
    if (!subgraphName) {
      log.error(`Subgraph context for ${schemaName} not found`);
      return false;
    }
    const graphqlContext = context.graphqlContexts[subgraphName];
    if (!graphqlContext) {
      log.error(`Subgraph context for ${subgraphName} not found`);
      return false;
    }

    // Query all block change logs since the last processed block
    const changeLogQuery = createEntityQuery(context.schema, schemaName, {
      first: graphqlContext.pagination.maxRowsPerRequest,
      order: {
        by: 'blockNumber',
        direction: 'desc'
      },
      filters: {
        blockNumber_gte: fromBlock
      },
      withMetadata: true
    });

    const results = await executeRequests(graphqlContext, [
      changeLogQuery,
    ]);
    const { _meta: lastProcessedBlock } = results as EntityDataCollection<WithMetadata>;

    if (!lastProcessedBlock) {
      log.error(`${STRATEGY_NAME}: No last processed block found in the subgraph response ${JSON.stringify(results, null, 2)}, for query: ${JSON.stringify(changeLogQuery, null, 2)}`);

      return false;
    }

    await context.dbContext.db('LastProcessedBlock')
      .insert<LastProcessedBlock>({
        id: true, // there will only ever be one last processed block
        hash: lastProcessedBlock.block.hash,
        number: lastProcessedBlock.block.number,
        timestamp: lastProcessedBlock.block.timestamp
      })
      .onConflict('id')
      .merge()
      .on('query', function (data: unknown) {
        log.debug(`${STRATEGY_NAME}: Updated last processed block to ${lastProcessedBlock.block.hash} at number ${lastProcessedBlock.block.number}`, data);
      })
      .then((v) => {
        log.debug(`${STRATEGY_NAME}: Successfully updated last processed block`, v);
      })
      .catch(err => {
        log.error(`${STRATEGY_NAME}: Failed to update last processed block`, err);
      });

    const blockChangeLogResults = results[schemaName];
    const blockChangeLogs = blockChangeLogResults as BlockChangeLog[];
    const [lastBlockChangeLog] = blockChangeLogs;
    const lastBlockNumber = BigInt(lastBlockChangeLog.blockNumber);

    if (lastBlockChangeLog.id === lastStoredBlockHash.toString()) {
      log.info(`${STRATEGY_NAME}: No new changes since last processed event`);

      return false;
    }

    // Get all unique entities that were updated in any of these blocks
    const entitiesToSync = Array.from(new Set<string>(blockChangeLogs.flatMap(result => result.updatedEntities || [])));

    if (entitiesToSync.length === 0) {
      log.info(`${STRATEGY_NAME}: No entities to sync`);

      return false;
    }

    // Process the changes specific to this strategy
    log.info(`${STRATEGY_NAME}: Processing ${entitiesToSync.length} entities: ${entitiesToSync.join(', ')}`);

    // Add BlockChangeLog itself to the entities to sync
    const allEntitiesToSync = [...entitiesToSync, schemaName];
    const validEntities = allEntitiesToSync.filter(entityName => context.schema.entities.has(entityName) && !isIgnorableEntity(entityName));

    if (validEntities.length) {
      // Pass block information to track entity IDs
      const entityData = await syncEntities(
        context,
        validEntities,
        lastBlockNumber
      );

      await trackEntityIds(context.dbContext, entityData, lastBlockNumber, lastBlockChangeLog.id);

      // Prune old EntityChangeLog entries to prevent unbounded growth
      // Only keep entries within the reorg detection window
      await pruneOldEntityChangeLog(context.dbContext.db, lastBlockNumber);

      return true;
    }

    return false;
  };

  return { name: STRATEGY_NAME, detectAndProcess };

};
