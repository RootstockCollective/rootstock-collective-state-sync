import { info } from 'loglevel';
import { Hex, PublicClient } from 'viem';
import { DatabaseContext } from '../../context/db';
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

const BATCH_SIZE = 1000; // TODO: @jurajpiar make env var

// TODO: verify if we need this function since we no longer use it
const findLastValidBlock = async (db: DatabaseContext['db'], client: PublicClient, fromBlock: bigint) => {

  let upperExclusive: bigint = fromBlock

  while (true) {
    const candidates = await fetchBatchByBlockNumberDesc(db, upperExclusive, BATCH_SIZE);

    if (candidates.length === 0) {
      return -1n;
    }

    for (const block of candidates) {
      const onchainBlock = await getBlockFromNode(client, block.blockNumber);

      if (onchainBlock && areHashesEqual(convertDbIdToHash(block.id), onchainBlock.hash)) {
        return block.blockNumber;
      }
    }

    const last = candidates[candidates.length - 1];
    upperExclusive = last.blockNumber;
  }
}

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

      await createSchema(dbContext, 'new_public');
      const newContext = createContextWithSchema(context, 'new_public');
      const entities = await createDb(newContext, false, true);

      // Initial sync of entities
      await syncEntities(newContext, entities);

      await switchSchema(dbContext, 'new_public', 'public');

      return true;
    }

    return false;
  }

  return {
    name: 'reorgCleanupStrategy',
    detectAndProcess
  }
}
