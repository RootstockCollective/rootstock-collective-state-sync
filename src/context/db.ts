import { Database } from '../config/types';
import knex, { Knex } from 'knex';
import * as fs from 'fs';
import type { ConnectionOptions } from 'tls';

export const PUBLIC_SCHEMA = 'public';

interface DatabaseContext {
    db: Knex;
    schema: string; 
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

// Factory function to create a database context
const createDatabaseContext = (database: Database, schema: string, envName: string): DatabaseContext => {
  if (!database) {
    throw new TypeError('Database configuration is required');
  }
  const { connectionString, ssl, ...rest } = database;

  let sslConfig: ConnectionOptions | boolean = false;

  if (ssl) {
    const certPath = '/app/rds-ca-cert.pem';
    sslConfig = fs.existsSync(certPath) ? {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString(),
    } : false;
  }

  const db = knex({
    client: 'pg',
    connection: {
      connectionString,
      ssl: sslConfig,
      application_name: `state-sync-${envName}`,
    },
    searchPath: [schema],
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30_000,
      acquireTimeoutMillis: 30_000,
    },
  });

  return { db, schema, ...rest };
};

export { createDatabaseContext };
export type { DatabaseContext };
