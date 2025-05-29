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
        if (!column || column.references) continue;
        filtered[key] = (value && typeof value === 'object' && 'id' in value) ? value.id : value;
    }
    return filtered;
};

// Prepare upsert SQL a
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

    const { db } = dbContext;

    const columnMap = createColumnMap(entity);

    const filteredRecords = records.map(record => filterReferenceFields(record, columnMap));

    await db(tableName).insert(filteredRecords).onConflict('id').merge();
};
