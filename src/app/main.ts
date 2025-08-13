import log from 'loglevel';

import { getConfig } from '../config/config';
import { createContexts } from '../context/create';
import { createDb } from '../handlers/dbCreator';
import { syncEntities } from '../handlers/subgraphSyncer';
import { watchBlocks } from '../watchers/blockWatcher';

const main = async () => {
  try {
    const config = getConfig();

    const { logLevel } = config.app;

    log.setLevel(logLevel);

    const context = createContexts(config);

    // Create database schema
    const entities = await createDb(context, config.app);

    // Initial sync of entities
    await syncEntities(context, entities);

    watchBlocks(context);

  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
}

main();
