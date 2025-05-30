import { Database, Secrets } from '../config/types';
import knex, { Knex } from 'knex';
export interface DatabaseContext {
    db: Knex;
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

// Factory function to create a database context
export const createDatabaseContext = (database: Database, secrets: Secrets): DatabaseContext => {
    const db = knex({
        client: 'pg',
        connection: {
            connectionString: secrets.database.connectionString
        }
    });

    return { db, ...database };
};
