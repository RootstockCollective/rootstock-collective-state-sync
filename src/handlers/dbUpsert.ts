import type { Knex } from 'knex';
import { Column, Entity } from '../config/types';
import { DatabaseContext } from '../context/db';
import { DatabaseSchema } from '../context/schema';
import { processBatches } from '../utils/batch';
import { withRetry } from '../utils/retry';

type DatabaseRecord = Record<string, unknown>;

const createColumnMap = (entity: Entity): Record<string, Column> =>
  entity.columns.reduce((acc, col) => {
    acc[col.name] = col;
    return acc;
  }, {} as Record<string, Column>);

const filterReferenceFields = (record: DatabaseRecord, columnMap: Record<string, Column>): DatabaseRecord => {
  const filtered: DatabaseRecord = {};
  for (const [key, value] of Object.entries(record)) {
    const column = columnMap[key];
    if (!column) continue;
    filtered[key] = (value && typeof value === 'object' && 'id' in value) ? value.id : value;
  }
  return filtered;
};

const executeUpsert = async (
  dbContext: DatabaseContext,
  tableName: string, 
  records: DatabaseRecord[],
  schema: DatabaseSchema,
  trx?: Knex.Transaction
): Promise<void> => {
  if (records.length === 0) return;

  const entity = schema.entities.get(tableName);
  if (!entity) {
    throw new Error(`Entity "${tableName}" not found in schema`);
  }

  const { db, batchSize, maxRetries, initialRetryDelay } = dbContext;
  const columnMap = createColumnMap(entity);
  const dbOrTrx = trx ?? db;

  await processBatches(
    records,
    batchSize,
    async (batch) => {
      const filteredBatch = batch.map(record => filterReferenceFields(record, columnMap));

      await withRetry(
        async () => {
          // Note: For PostgreSQL, upsert is handled via onConflict() and merge() methods
          // rather than upsert() which is only supported in SQLite and MySQL
          // See: https://knexjs.org/guide/query-builder.html#upsert
          // See: https://knexjs.org/guide/query-builder.html#onconflict
          await dbOrTrx(tableName)
            .insert(filteredBatch)
            .onConflict(entity.primaryKey)
            .merge();
        },
        maxRetries,
        initialRetryDelay
      );
    }
  );
};

export { executeUpsert };
