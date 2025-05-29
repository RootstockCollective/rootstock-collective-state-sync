import { Pool } from 'pg';
import { Secrets } from '../config/types';
import knex, { Knex } from 'knex';
export interface DatabaseContext {
    db: Knex;
}

// Factory function to create a database context
export const createDatabaseContext = (secrets: Secrets): DatabaseContext => {
    const db = knex({
        client: 'pg',
        connection: {
            connectionString: secrets.database.connectionString
        }
    });

    return { db };
};
