import { Column, Entity } from '../config/types';
import { DatabaseContext } from '../context/db';
import { DatabaseSchema } from '../context/schema';

type DatabaseRecord = Record<string, any>;

const createColumnMap = (entity: Entity): Record<string, Column> =>
    entity.columns.reduce((acc, col) => {
        acc[col.name] = col;
        return acc;
    }, {} as Record<string, Column>);

const filterReferenceFields = (record: DatabaseRecord, columnMap: Record<string, Column>): DatabaseRecord => {
    const filtered: DatabaseRecord = {}
    for (const [key, value] of Object.entries(record)) {
        const column = columnMap[key];
        if (!column) continue;
        filtered[key] = (value && typeof value === 'object' && 'id' in value) ? value.id : value;
    }
    return filtered;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number,
    initialRetryDelay: number
): Promise<T> => {
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= maxRetries) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            retryCount++;
            
            if (retryCount <= maxRetries) {
                const delay = initialRetryDelay * Math.pow(2, retryCount - 1);
                await wait(delay);
            }
        }
    }

    throw new Error(`Operation failed after ${maxRetries} retries. Last error: ${lastError?.message}`);
};

const executeUpsert = async (
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

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const filteredBatch = batch.map(record => filterReferenceFields(record, columnMap));

        await withRetry(
            async () => {
                // Note: For PostgreSQL, upsert is handled via onConflict() and merge() methods
                // rather than upsert() which is only supported in SQLite and MySQL
                // See: https://knexjs.org/guide/query-builder.html#upsert
                // See: https://knexjs.org/guide/query-builder.html#onconflict
                await db(tableName)
                    .insert(filteredBatch)
                    .onConflict(entity.primaryKey)
                    .merge();
            },
            maxRetries,
            initialRetryDelay
        );
    }
}

export { executeUpsert }
