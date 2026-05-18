import log from 'loglevel';
import { Hex, PublicClient } from 'viem';
import { PUBLIC_SCHEMA } from '../../context/db';
import { AppContext } from '../../context/types';
import { createContextWithSchema } from '../../context/create';
import { getLastProcessedBlock } from './utils';
import { createSchemaFresh, switchSchema, withReorgLock } from '../../handlers/schema';
import { createDb } from '../../handlers/dbCreator';
import { syncEntities } from '../../handlers/subgraphSyncer';

const convertDbIdToHash = (id: string): Hex => {
  return Buffer.from(id, 'hex').toString('utf-8') as Hex;
};

const NEW_SCHEMA = 'tmp_public';
const SHOULD_INITIALIZE_DB = false;

export interface ReorgGateOutcome {
  /**
   * When true, the rest of this block tick's strategies should not run.
   * Set when this replica or another is mid-rebuild — writes to `public`
   * during that window would be dropped by the upcoming switchSchema.
   */
  skipRest: boolean;
}

interface ReorgGateParams {
  context: AppContext;
  client: PublicClient;
}

const rebuildPublicFromSubgraph = async (context: AppContext): Promise<boolean> => {
  const { dbContext } = context;
  await createSchemaFresh(dbContext, NEW_SCHEMA);
  const newContext = createContextWithSchema(context, NEW_SCHEMA);
  let succeeded = false;
  try {
    const entities = await createDb(newContext, SHOULD_INITIALIZE_DB);
    await syncEntities(
      newContext,
      entities.filter((entity) => entity !== 'LastProcessedBlock'),
    );
    await switchSchema(dbContext, NEW_SCHEMA, PUBLIC_SCHEMA);
    succeeded = true;
    return true;
  } finally {
    await newContext.dbContext.db.destroy();
    if (!succeeded) {
      await dbContext.db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [NEW_SCHEMA]);
    }
  }
};

/**
 * Reorg gate. Runs at the very top of every block tick.
 *
 * Outcomes:
 *  - No prior block data (initial state) → not a reorg, allow rest to run.
 *  - On-chain hash matches stored hash → not a reorg, allow rest to run.
 *  - Mismatch and this session acquires the advisory lock → rebuild `public`
 *    from the subgraph atomically, then allow the rest of the strategies to
 *    run. The rebuild deliberately excludes `LastProcessedBlock`; letting
 *    `blockChangeLogStrategy` run on this same tick repopulates that row in
 *    the freshly-swapped `public`.
 *  - Mismatch but another session holds the advisory lock → another replica
 *    is mid-rebuild. Signal skipRest=true so we do not write to a `public`
 *    that is about to be dropped by the upcoming switchSchema.
 */
export const runReorgGate = async ({
  context,
  client,
}: ReorgGateParams): Promise<ReorgGateOutcome> => {
  const { dbContext } = context;

  const { id, blockNumber } = await getLastProcessedBlock(dbContext.db);

  if (blockNumber === BigInt(0)) {
    return { skipRest: false };
  }

  const { hash: onchainBlockHash } = await client.getBlock({ blockNumber });
  const storedBlockHash = convertDbIdToHash(id);

  if (onchainBlockHash === storedBlockHash) {
    return { skipRest: false };
  }

  log.info('[reorgGate] Reorg detected');

  const outcome = await withReorgLock(dbContext, () =>
    rebuildPublicFromSubgraph(context),
  );

  if (!outcome.acquired) {
    log.info('[reorgGate] Reorg cleanup already in progress on another session, skipping');
    return { skipRest: true };
  }

  // We just rebuilt `public`. Allow the rest of the strategies to run so
  // blockChangeLogStrategy can populate LastProcessedBlock on this tick.
  return { skipRest: false };
};
