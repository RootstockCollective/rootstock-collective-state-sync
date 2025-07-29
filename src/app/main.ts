import log from 'loglevel';

import { createDb } from '../handlers/dbCreator';
import { syncEntities } from '../handlers/subgraphSyncer';
import { getConfig } from '../config/config';
import { watchBlocks } from '../watchers/blockWatcher';
import { createContexts } from '../context/create';

const main = async () => {
  try {
    const config = getConfig();

    const { logLevel, productionMode } = config.app;

    log.setLevel(logLevel);

    const context = createContexts(config);

    // Create database schema
    const entities = await createDb(context, config.app);

    // Initial sync of entities
    await syncEntities(context, entities);

    if (!productionMode) {
      process.exit(0);
    }

    watchBlocks(context);
  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
}

main();
