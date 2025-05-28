import log from 'loglevel';

import { createDb } from '../handlers/dbCreation';
import { syncAllEntities, createEntityChangeHandler } from '../handlers/syncOrchestrator';
import { getConfig } from '../config/config';
import { watchBlocks } from '../watchers/blockWatcher';
import { createClient } from '../client/createClient';
import { initializeContexts } from '../context/initialize';

const main = async () => {
  try {
    const config = getConfig();

    log.setLevel(log.levels.INFO);
    
    const context = initializeContexts(config);

    // Create database schema
    await createDb(context);

    // Start sync process
    await syncAllEntities(context);

    const client = createClient(config);

    // Create entity change handler
    const handleEntityChange = createEntityChangeHandler(context);

    // Start watching blocks with the entity change handler
    watchBlocks(context, client, handleEntityChange);

  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
};

main();