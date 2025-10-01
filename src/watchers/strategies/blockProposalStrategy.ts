import { ChangeStrategy, Proposal } from './types';
import { AppContext } from '../../context/types';
import { PublicClient } from 'viem';
import log from 'loglevel';
import { createEntityQuery } from '../../handlers/subgraphQueryBuilder';
import { executeRequests } from '../../context/subgraphProvider';
import { syncEntities } from '../../handlers/subgraphSyncer';
import { DatabaseContext } from '../../context/db';

const MAINNET_VOTING_PERIOD_BLOCKS = 25000n

const createStrategy = (): ChangeStrategy => {

  const getLastProcessedBlock = async (
    dbContext: DatabaseContext
  ): Promise<bigint> => {

    const { db } = dbContext;

    const result = await db<Proposal>('Proposal').orderBy('createdAtBlock', 'desc').limit(1);
    if (result.length === 0) {
      return 0n;
    }

    return result[0].createdAtBlock;
  };

  const detectAndProcess = async (params: {
    context: AppContext;
    client: PublicClient;
    blockNumber: bigint | null;
  }): Promise<boolean> => {
    const { context } = params;
    if (!params.blockNumber) {
      log.error(`blockProposalStrategy->detectAndProcess: No block number provided, skipping processing`);
      return false;
    }
    const fromBlock = params.blockNumber - MAINNET_VOTING_PERIOD_BLOCKS;
    log.info(`blockProposalStrategy->detectAndProcess: Processing proposals since block ${fromBlock.toString()}`)

    // Find the subgraph context for Proposal entity
    const proposalEntity = context.schema.entities.get('Proposal');
    if (!proposalEntity) {
      log.error('Proposal entity not found in schema');
      return false;
    }

    const subgraphName = proposalEntity.subgraphProvider;
    const graphqlContext = context.graphqlContexts[subgraphName];
    if (!graphqlContext) {
      log.error(`Subgraph context for ${subgraphName} not found`);
      return false;
    }

    // Query all block change logs since the last processed block
    const query = createEntityQuery(context.schema, 'Proposal', {
      first: graphqlContext.pagination.maxRowsPerRequest,
      order: {
        by: 'createdAtBlock',
        direction: 'desc'
      },
      filters: {
        createdAtBlock_gt: fromBlock
      }
    });

    const results = await executeRequests(graphqlContext, [query]);
    const proposals = results['Proposal'] as Proposal[] || [];

    if (proposals.length === 0) {
      log.info(`${strategy.name}: No entities to sync`);
      return false;
    }

    // Process the changes specific to this strategy
    log.info(`blockProposalStrategy->detectAndProcess: Processing ${proposals.length} entities: ${proposals.map(p => p.proposalId).join(', ')}`);

    // Add Proposal itself to the entities to sync
    const allEntitiesToSync = ['Account','Proposal','VoteCast'];
    const validEntities = allEntitiesToSync.filter(entityName => context.schema.entities.has(entityName));

    if (validEntities.length > 0) {
      await syncEntities(context, validEntities, fromBlock);
      return true;
    }

    return true;
  };

  const strategy = {
    name: 'NewProposal',
    detectAndProcess
  };
  return strategy;
};

export const createNewProposalStrategy = () => createStrategy();
