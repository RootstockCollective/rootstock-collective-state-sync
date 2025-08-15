import { info } from 'loglevel';
import { Hex, PublicClient } from 'viem';
import { DatabaseContext } from '../../context/db';
import { AppContext } from '../../context/types';
import { BlockChangeLog, ChangeStrategy } from './types';
import { getLastProcessedBlock } from './utils';

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
    context: {
      dbContext: {
        db
      }
    }
  }: {
    context: AppContext;
    client: PublicClient;
  }): Promise<boolean> => {
    const { id, blockNumber } = await getLastProcessedBlock(db);

    const {
      hash: onchainBlockHash,
    } = await client.getBlock({
      blockNumber
    })

    const blockHash = convertDbIdToHash(id);

    if (onchainBlockHash !== blockHash) {
      info('Reorg detected');
      const lastValidBlockNumber = await findLastValidBlock(db, client, blockNumber).catch((e) => {
        throw new Error('Failed to find last valid block number with error: ' + e.message);

      });

      await db.transaction((tx) => {
        // FIXME: None of the other tables reference block hash, which may cause data inconsistency when deleting block change logs
        db<BlockChangeLog>('BlockChangeLog')
          .transacting(tx)
          .where('blockNumber', '>', lastValidBlockNumber).delete()
          .then(tx.commit)
          .catch((e) => {
            tx.rollback();
            throw new Error('Failed to delete block change logs with error: ' + e.message);
          });
      }).catch((e) => {
        throw new Error('Reorg cleanup transaction failed with error: ' + e.message);
      });

      return true;
    }

    return false;
  }

  return {
    name: 'reorgCleanupStrategy',
    detectAndProcess
  }
}
