import { Config } from '../config/types';

/**
 * Creates a mock configuration for testing
 * This avoids the need for actual config files or database connections
 */
export const createMockConfig = (overrides?: Partial<Config>): Config => {
  return {
    app: {
      initializeDb: false,
      logLevel: 'error',
      productionMode: false,
      ...overrides?.app
    },
    database: {
      connectionString: 'postgresql://test:test@localhost:5432/test_db',
      batchSize: 100,
      maxRetries: 1,
      initialRetryDelay: 100,
      ssl: false,
      ...overrides?.database
    },
    blockchain: {
      network: 'testnet',
      blockIntervalThreshold: 1,
      ...overrides?.blockchain
    },
    subgraphProviders: {
      'collective-rewards': {
        url: 'http://localhost:8000',
        maxRowsPerRequest: 10,
        id: 'test-collective-rewards',
        apiKey: 'test-api-key'
      },
      governance: {
        url: 'http://localhost:8001',
        maxRowsPerRequest: 10,
        id: 'test-governance',
        apiKey: 'test-api-key'
      },
      ...overrides?.subgraphProviders
    },
    contracts: overrides?.contracts || [
      { name: 'BackersManager', address: '0x0000000000000000000000000000000000000001' },
      { name: 'BuilderRegistry', address: '0x0000000000000000000000000000000000000002' },
      { name: 'RewardDistributor', address: '0x0000000000000000000000000000000000000003' },
      { name: 'Governor', address: '0x0000000000000000000000000000000000000004' }
    ],
    entities: overrides?.entities || []
  };
};

/**
 * Creates a mock AppContext for testing
 */
export const createMockContext = () => {
  const config = createMockConfig();
  
  return {
    config,
    schema: {
      entities: new Map()
    },
    dbContext: {
      db: {} as any, // Should be replaced with proper mock
      schema: 'public',
      batchSize: config.database.batchSize,
      maxRetries: config.database.maxRetries,
      initialRetryDelay: config.database.initialRetryDelay
    },
    graphqlContexts: {}
  };
};
