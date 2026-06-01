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

const DEFAULT_CA_CERT_PATH = '/app/rds-ca-cert.pem';

// Factory function to create a database context
const createDatabaseContext = (
  database: Database,
  schema: string,
  envName: string,
  certPath: string = DEFAULT_CA_CERT_PATH,
): DatabaseContext => {
  if (!database) {
    throw new TypeError('Database configuration is required');
  }
  const { connectionString, ssl, ...rest } = database;

  let sslConfig: ConnectionOptions | boolean = false;

  if (ssl) {
    if (!fs.existsSync(certPath)) {
      throw new Error(
        `Database SSL is enabled but CA certificate not found at ${certPath}. ` +
        'Refusing to connect over an unencrypted channel. ' +
        'Provide the certificate file or set database.ssl to false explicitly.'
      );
    }
    sslConfig = {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString(),
    };
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
