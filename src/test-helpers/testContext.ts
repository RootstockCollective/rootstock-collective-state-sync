import { Config } from '../config/types';
import { createContexts } from '../context/create';
import { createMockConfig } from './mockConfig';
import { DatabaseContext } from '../context/db';
import { AppContext } from '../context/types';
import { createDb } from '../handlers/dbCreator';

/**
 * Creates a real test AppContext with an actual database connection.
 * 
 * Uses TEST_DATABASE_URL or default test database connection.
 * Requires test database to be running (e.g., via docker-compose up -d postgres).
 * 
 * Usage:
 * ```typescript
 * describe('Integration tests', () => {
 *   let testContext: AppContext;
 *   
 *   before(async () => {
 *     testContext = await createTestContext();
 *   });
 *   
 *   after(async () => {
 *     await teardownTestContext(testContext);
 *   });
 *   
 *   beforeEach(async () => {
 *     await cleanTestDatabase(testContext.dbContext);
 *   });
 * });
 * ```
 */
export const createTestContext = async (
  overrides?: Partial<Config>
): Promise<AppContext> => {
  const config = createMockConfig({
    ...overrides,
    database: {
      connectionString: process.env.TEST_DATABASE_URL || 
        'postgresql://test:test@localhost:5432/test',
      batchSize: 100,
      maxRetries: 1,
      initialRetryDelay: 100,
      ssl: false,
      ...overrides?.database
    },
    app: {
      initializeDb: true,
      logLevel: 'error',
      productionMode: false,
      ...overrides?.app
    }
  });

  const context = createContexts(config);
  
  // Initialize database schema (create tables)
  await createDb(context, false, true);
  
  return context;
};

/**
 * Tears down the test context.
 */
export const teardownTestContext = async (context: AppContext): Promise<void> => {
  await context.dbContext.db.destroy();
};

/**
 * Creates a test database context with a real connection.
 * Useful for testing database queries in isolation.
 */
export const createTestDatabaseContext = async (
  connectionString?: string
): Promise<DatabaseContext> => {
  const { createDatabaseContext, PUBLIC_SCHEMA } = await import('../context/db.js');
  
  return createDatabaseContext(
    {
      connectionString: connectionString || 
        process.env.TEST_DATABASE_URL || 
        'postgresql://test:test@localhost:5432/test',
      batchSize: 100,
      maxRetries: 1,
      initialRetryDelay: 100,
      ssl: false
    },
    PUBLIC_SCHEMA
  );
};

/**
 * Helper to clean all tables in the test database.
 * Use in beforeEach/afterEach to ensure test isolation.
 */
export const cleanTestDatabase = async (dbContext: DatabaseContext): Promise<void> => {
  const { db } = dbContext;
  
  // Get all table names
  const tables = await db.raw(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
  `);
  
  // Truncate all tables (faster than delete, resets sequences)
  for (const row of tables.rows) {
    await db.raw(`TRUNCATE TABLE "${row.tablename}" RESTART IDENTITY CASCADE`);
  }
};

