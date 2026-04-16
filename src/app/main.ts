import log from 'loglevel';

import { getConfig } from '../config/config';
import { createContexts } from '../context/create';
import { createDb } from '../handlers/dbCreator';
import { syncEntities } from '../handlers/subgraphSyncer';
import { watchBlocks } from '../watchers/blockWatcher';

const main = async () => {
  try {
    const config = getConfig();

    const { logLevel, productionMode, initializeDb } = config.app;

    log.setLevel(logLevel);

    const context = createContexts(config);

    const shutdown = async () => {
      log.info('Shutting down: destroying database pool');
      try {
        await context.dbContext.db.destroy();
      } catch (err) {
        log.error('Error destroying database pool during shutdown:', err);
      }
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Create database schema
    const entities = await createDb(context, productionMode, initializeDb);

    // Initial sync of entities
    await syncEntities(context, entities.filter(entity => entity !== 'LastProcessedBlock')); // TODO: We should change this a little bit, so that we don't have to filter out LastProcessedBlock here in this hardcoded way

    if (!productionMode) {
      await context.dbContext.db.destroy();
      process.exit(0);
    }

    watchBlocks(context);
  } catch (error) {
    log.error('Error in main process:', error);
    process.exit(1);
  }
};

main();
