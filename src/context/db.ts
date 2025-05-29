import { Pool } from 'pg';
import { Secrets } from '../config/types';
export interface DatabaseContext {
    pool: Pool;
}

// Factory function to create a database context
export const createDatabaseContext = (secrets: Secrets): DatabaseContext => {
    const pool = new Pool({
        connectionString: secrets.database.connectionString,
    });

    return { pool };
};
