import { DatabaseSchema } from './types';
import { Entity } from '../config/config';
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
        if (!column || column.references) continue;
        filtered[key] = (value && typeof value === 'object' && 'id' in value) ? value.id : value;
    }
    return filtered;
};

// Generate placeholders like ($1, $2), ($3, $4), ...
const generatePlaceholders = (recordCount: number, columns: string[]): string =>
    Array.from({ length: recordCount }, (_, i) =>
        `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
    ).join(', ');

// Generate "SET col = EXCLUDED.col" for upsert
const generateUpdateSet = (columns: string[]): string =>
    columns
        .filter(col => col !== 'id')
        .map(col => `"${col}" = EXCLUDED."${col}"`)
        .join(', ');

// Build the final query
const buildUpsertQuery = (tableName: string, columns: string[], placeholders: string, updateSet: string): string =>
    `INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
     VALUES ${placeholders}
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`;

// Flatten records into values array
const flattenRecords = (records: DatabaseRecord[], columns: string[]): any[] =>
    records.flatMap(record => columns.map(col => record[col] ?? null));

// Ensure consistent column list across all records
const normalizeRecords = (records: DatabaseRecord[], columns: string[]): DatabaseRecord[] =>
    records.map(record =>
        Object.fromEntries(columns.map(col => [col, record[col] ?? null]))
    );

// Prepare upsert SQL and values
const prepareUpsertData = (records: DatabaseRecord[], entity: Entity) => {
    const columnMap = createColumnMap(entity);

    const filteredRecords = records.map(record => filterReferenceFields(record, columnMap));
    const columns = entity.columns.filter(col => !col.references).map(col => col.name);

    const placeholders = generatePlaceholders(filteredRecords.length, columns);
    const updateSet = generateUpdateSet(columns);
    const query = buildUpsertQuery(entity.name, columns, placeholders, updateSet);
    const values = flattenRecords(filteredRecords, columns);

    return { query, values };
};

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

    const { query, values } = prepareUpsertData(records, entity);

    const client = await dbContext.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(query, values);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to upsert records into "${tableName}": ${message}`);
    } finally {
        client.release();
    }
};
