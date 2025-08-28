import { info } from 'loglevel';
import { Hex, PublicClient } from 'viem';
import { DatabaseContext, PUBLIC_SCHEMA } from '../../context/db';
import { AppContext } from '../../context/types';
import { createContextWithSchema } from '../../context/create';
import { BlockChangeLog, ChangeStrategy } from './types';
import { getLastProcessedBlock } from './utils';
import { createSchema, switchSchema } from '../../handlers/schema';
import { createDb } from '../../handlers/dbCreator';
import { syncEntities } from '../../handlers/subgraphSyncer';

const getBlockFromNode = (client: PublicClient, blockNumber: bigint) => {
  return client.getBlock({ blockNumber });
}

const areHashesEqual = (a: Hex, b: Hex): boolean => {
  return a === b;
}

const convertDbIdToHash = (id: string): Hex => {
  return Buffer.from(id, 'hex').toString('utf-8') as Hex;
}

const fetchBatchByBlockNumberDesc = async (
  db: DatabaseContext['db'],
  fromBlockExclusive?: bigint,
  limit = 1000
): Promise<BlockChangeLog[]> => {
  let query = db<BlockChangeLog>('BlockChangeLog')
    .orderBy('blockNumber', 'desc')
    .limit(limit);

  if (fromBlockExclusive !== undefined) {
    query = query.where('blockNumber', '<', fromBlockExclusive);
  }

  return query;
}

const NEW_SCHEMA = 'tmp_public';
const SHOULD_INITIALIZE_DB = false;
const IS_PRODUCTION_MODE = true;
export const createRevertReorgsStrategy = (): ChangeStrategy => {

  const detectAndProcess = async ({
    client,
    context
  }: {
    context: AppContext;
    client: PublicClient;
  }): Promise<boolean> => {
    const { dbContext } = context;

    const { id, blockNumber } = await getLastProcessedBlock(dbContext.db);

    const {
      hash: onchainBlockHash,
    } = await client.getBlock({
      blockNumber
    })

    const blockHash = convertDbIdToHash(id);

    if (onchainBlockHash !== blockHash) {
      info('Reorg detected');

      await createSchema(dbContext, NEW_SCHEMA);
      const newContext = createContextWithSchema(context, NEW_SCHEMA);
      const entities = await createDb(newContext, IS_PRODUCTION_MODE, SHOULD_INITIALIZE_DB);

      // Initial sync of entities
      await syncEntities(newContext, entities);

      await switchSchema(dbContext, NEW_SCHEMA, PUBLIC_SCHEMA);

      return true;
    }

    return false;
  }

  return {
    name: 'reorgCleanupStrategy',
    detectAndProcess
  }
}
