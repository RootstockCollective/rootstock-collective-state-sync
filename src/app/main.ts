import log from 'loglevel';

import { getConfig } from '../config/config';
import { createContexts } from '../context/create';
import { createDb } from '../handlers/dbCreator';
import { syncEntities } from '../handlers/subgraphSyncer';
import { watchBlocks } from '../watchers/blockWatcher';

const main = async () => {
  try {
    const config = getConfig();

    const { logLevel, productionMode } = config.app;

    log.setLevel(logLevel);

    const context = createContexts(config);

    // Create database schema
    const entities = await createDb(context, config.app);

    // Initial sync of entities
    await syncEntities(context, entities.filter(entity => entity !== 'LastProcessedBlock')); // TODO: We should change this a little bit, so that we don't have to filter out LastProcessedBlock here in this hardcoded way

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
