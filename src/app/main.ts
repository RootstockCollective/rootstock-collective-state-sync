import log from 'loglevel';

import { getConfig } from '../config/config';
import { createContexts } from '../context/create';
import { createDb } from '../handlers/dbCreator';
import { syncEntities } from '../handlers/subgraphSyncer';
import { isIgnorableEntity } from '../utils/entityUtils';
import { watchBlocks } from '../watchers/blockWatcher';

const main = async () => {
  try {
    const config = getConfig();

    const { logLevel, productionMode, initializeDb } = config.app;

    log.setLevel(logLevel);

    const context = createContexts(config);

    // Create database schema
    const entities = await createDb(context, productionMode, initializeDb);

    // Initial sync of entities
    // Filter out local tracking tables that aren't synced from subgraph
    await syncEntities(context, entities.filter(entity => !isIgnorableEntity(entity)));

    if (!productionMode) {
      process.exit(0);
    }

    watchBlocks(context);
  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
};

main();
