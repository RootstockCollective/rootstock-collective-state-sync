import { Pool } from 'pg';
import { DatabaseConfig } from '../config/config';
export interface DatabaseContext {
    pool: Pool;
}

// Factory function to create a database context
export const createDatabaseContext = (config: DatabaseConfig): DatabaseContext => {
    const pool = new Pool(config);

    return { pool };
};
