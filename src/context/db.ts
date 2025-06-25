import { Database } from '../config/types';
import knex, { Knex } from 'knex';
import * as fs from 'fs';

interface DatabaseContext {
    db: Knex;
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

// Factory function to create a database context
const createDatabaseContext = (database: Database): DatabaseContext => {
    const { connectionString, ...rest } = database;
    
    // Check if SSL certificate exists and configure SSL accordingly
    const certPath = '/app/rds-ca-cert.pem';
    const sslConfig = fs.existsSync(certPath) ? {
        rejectUnauthorized: true,
        ca: fs.readFileSync(certPath).toString(),
    } : false;
    
    const db = knex({
        client: 'pg',
        connection: {
            connectionString,
            ssl: sslConfig,
        },
    });

    return { db, ...rest }
}

export { createDatabaseContext }
export type { DatabaseContext }
