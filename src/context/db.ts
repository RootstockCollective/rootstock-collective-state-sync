import { Database } from '../config/types';
import knex, { Knex } from 'knex';
interface DatabaseContext {
    db: Knex;
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

// Factory function to create a database context
const createDatabaseContext = (database: Database): DatabaseContext => {
    const { connectionString, ...rest } = database;
    const db = knex({
        client: 'pg',
        connection: {
            connectionString,
        },
    });

    return { db, ...rest }
}

export { createDatabaseContext }
export type { DatabaseContext }
