import log from 'loglevel';

import { createDb } from '../handlers/dbCreator';
import { syncAllEntities, createEntityChangeHandler } from '../handlers/syncOrchestrator';
import { getConfig } from '../config/config';
import { watchBlocks } from '../watchers/blockWatcher';
import { createClient } from '../client/createClient';
import { createContexts } from '../context/create';

const main = async () => {
  try {
    const config = getConfig();

    log.setLevel(config.app.logLevel);

    const context = createContexts(config);

    if (config.app.restartDb) {
      // Create database schema
      await createDb(context);

      // Start sync process
      await syncAllEntities(context);
    }

    // Create entity change handler
    const handleEntityChange = createEntityChangeHandler(context);

    const client = createClient(config);
    // Start watching blocks with the entity change handler
    watchBlocks(context, client, handleEntityChange);

  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
};

main();
