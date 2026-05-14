import { info } from 'loglevel';
import { Hex, PublicClient } from 'viem';
import { PUBLIC_SCHEMA } from '../../context/db';
import { AppContext } from '../../context/types';
import { createContextWithSchema } from '../../context/create';
import { ChangeStrategy } from './types';
import { getLastProcessedBlock } from './utils';
import { createSchemaFresh, switchSchema, withReorgLock } from '../../handlers/schema';
import { createDb } from '../../handlers/dbCreator';
import { syncEntities } from '../../handlers/subgraphSyncer';

const convertDbIdToHash = (id: string): Hex => {
  return Buffer.from(id, 'hex').toString('utf-8') as Hex;
};

const NEW_SCHEMA = 'tmp_public';
const SHOULD_INITIALIZE_DB = false;
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

    // No prior block data — initial state, not a reorg
    if (blockNumber === BigInt(0)) {
      return false;
    }

    const {
      hash: onchainBlockHash,
    } = await client.getBlock({
      blockNumber
    });

    const blockHash = convertDbIdToHash(id);

    if (onchainBlockHash !== blockHash) {
      info('Reorg detected');

      const outcome = await withReorgLock(dbContext, async (): Promise<boolean> => {
        await createSchemaFresh(dbContext, NEW_SCHEMA);
        const newContext = createContextWithSchema(context, NEW_SCHEMA);
        let succeeded = false;
        try {
          const entities = await createDb(newContext, SHOULD_INITIALIZE_DB);

          // Initial sync of entities
          await syncEntities(newContext, entities.filter(entity => entity !== 'LastProcessedBlock'));

          await switchSchema(dbContext, NEW_SCHEMA, PUBLIC_SCHEMA);
          succeeded = true;
          return true;
        } finally {
          await newContext.dbContext.db.destroy();
          if (!succeeded) {
            await dbContext.db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [NEW_SCHEMA]);
          }
        }
      });

      if (!outcome.acquired) {
        info('Reorg cleanup already in progress, skipping');
        return false;
      }

      return outcome.result;
    }

    return false;
  };

  return {
    name: 'reorgCleanupStrategy',
    detectAndProcess
  };
};
