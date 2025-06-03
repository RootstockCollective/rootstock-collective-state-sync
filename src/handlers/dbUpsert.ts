import { DatabaseSchema } from './types';
import { Entity } from '../config/types';
import { DatabaseContext } from '../context/db';

type DatabaseRecord = Record<string, any>;

// Optimized: Create a column lookup map
const createColumnMap = (entity: Entity): Map<string, (typeof entity.columns)[number]> =>
    new Map(entity.columns.map(col => [col.name, col]));

// Filter and normalize reference fields
const filterReferenceFields = (record: DatabaseRecord, columnMap: Map<string, any>): DatabaseRecord => {
    const filtered: DatabaseRecord = {};
    for (const [key, value] of Object.entries(record)) {
        const column = columnMap.get(key);
        if (!column) continue;
        filtered[key] = (value && typeof value === 'object' && 'id' in value) ? value.id : value;
    }
    return filtered;
};

// Helper function to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Main function to execute upsert
export const executeUpsert = async (
    dbContext: DatabaseContext,
    tableName: string,
    records: DatabaseRecord[],
    schema: DatabaseSchema
): Promise<void> => {
    if (records.length === 0) return;

    const entity = schema.entities.get(tableName);
    if (!entity) {
        throw new Error(`Entity "${tableName}" not found in schema`);
    }

    const { db, batchSize, maxRetries, initialRetryDelay } = dbContext;
    const columnMap = createColumnMap(entity);

    // Process records in batches
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const filteredBatch = batch.map(record => filterReferenceFields(record, columnMap));
        
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount <= maxRetries) {
            try {
                // Note: For PostgreSQL, upsert is handled via onConflict() and merge() methods
                // rather than upsert() which is only supported in SQLite and MySQL
                // See: https://knexjs.org/guide/query-builder.html#upsert
                // See: https://knexjs.org/guide/query-builder.html#onconflict
                await db(tableName)
                    .insert(filteredBatch)
                    .onConflict(entity.primaryKey)
                    .merge();
                break; // Success, exit retry loop
            } catch (error) {
                lastError = error as Error;
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    const delay = initialRetryDelay * Math.pow(2, retryCount - 1);
                    await wait(delay);
                }
            }
        }

        if (retryCount > maxRetries) {
            throw new Error(`Failed to upsert batch after ${maxRetries} retries. Last error: ${lastError?.message}`);
        }
    }
};
