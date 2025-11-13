import { Knex } from 'knex';
import log from 'loglevel';
import { Column, Entity } from '../config/types';
import { DatabaseSchema } from '../context/schema';
import { AppContext } from '../context/types';
import { ColumnType, columnTypeConfigs, isArrayColumnType, isColumnType } from './types';

/**
 * Gets the column types for all primary key columns of a referenced entity
 */
const getReferencedIdColumnType = (schema: DatabaseSchema, type: ColumnType): ColumnType[] => {
  const referencedEntity = schema.entities.get(type);
  if (!referencedEntity) {
    throw new Error(`Referenced entity ${type} not found in schema`);
  }

  return referencedEntity.primaryKey.map(key => {
    const col = referencedEntity.columns.find(col => col.name === key);
    if (!col) {
      throw new Error(`Primary key column '${key}' not found in entity ${type}`);
    }
    if (isArrayColumnType(col.type) || !isColumnType(col.type)) {
      throw new Error(`Invalid column type for primary key '${key}' in entity ${type}`);
    }
    return col.type;
  });
};

/**
 * Gets the primary key column names for a referenced entity
 */
const getReferencedPrimaryKeyColumns = (schema: DatabaseSchema, entityType: ColumnType): string[] => {
  const referencedEntity = schema.entities.get(entityType);
  if (!referencedEntity) {
    throw new Error(`Referenced entity ${entityType} not found in schema`);
  }
  return referencedEntity.primaryKey;
};

/**
 * Applies nullable constraint to a column builder
 */
const applyNullableConstraint = (
  columnBuilder: Knex.ColumnBuilder,
  nullable?: boolean
): void => {
  if (nullable === true) {
    columnBuilder.nullable();
  } else {
    columnBuilder.notNullable();
  }
};

/**
 * Creates a column with the specified type and nullable constraint
 */
const createColumn = (
  table: Knex.TableBuilder,
  name: string,
  type: ColumnType,
  nullable?: boolean
): void => {
  const config = columnTypeConfigs[type];
  if (!config) {
    log.error(`Invalid column type: ${type}`);
    throw new Error(`Invalid column type: ${type}`);
  }
  const columnBuilder = config.knexHandler(table, name);
  applyNullableConstraint(columnBuilder, nullable);
};

/**
 * Validates that primary key columns are not nullable
 */
const validatePrimaryKeyColumns = (entity: Entity): void => {
  for (const column of entity.columns) {
    if (entity.primaryKey.includes(column.name) && column.nullable === true) {
      throw new Error(
        `Primary key column '${column.name}' in entity '${entity.name}' cannot be nullable`
      );
    }
  }
};

/**
 * Creates a foreign key column(s) for a referenced entity
 * Handles both single and composite primary keys
 */
const createForeignKeyColumn = (
  table: Knex.TableBuilder,
  column: Column,
  referencedEntityType: ColumnType,
  schema: DatabaseSchema
): void => {
  const referencedPrimaryKeys = getReferencedPrimaryKeyColumns(schema, referencedEntityType);
  const referencedColumnTypes = getReferencedIdColumnType(schema, referencedEntityType);

  if (referencedPrimaryKeys.length === 1) {
    // Simple foreign key: single column references single primary key
    const columnType = referencedColumnTypes[0];
    createColumn(table, column.name, columnType, column.nullable);
    table
      .foreign(column.name)
      .references(referencedPrimaryKeys[0])
      .inTable(referencedEntityType)
      .onDelete('CASCADE');
  } else {
    // Composite foreign key: multiple columns reference composite primary key
    // Create columns with names like: columnName_key1, columnName_key2, etc.
    const foreignKeyColumns: string[] = [];
    for (let i = 0; i < referencedPrimaryKeys.length; i++) {
      const pkColumnName = referencedPrimaryKeys[i];
      const pkColumnType = referencedColumnTypes[i];
      const fkColumnName = `${column.name}_${pkColumnName}`;
      
      createColumn(table, fkColumnName, pkColumnType, column.nullable);
      foreignKeyColumns.push(fkColumnName);
    }
    
    // Create composite foreign key constraint
    table
      .foreign(foreignKeyColumns)
      .references(referencedPrimaryKeys)
      .inTable(referencedEntityType)
      .onDelete('CASCADE');
  }
};

/**
 * Creates an array column with nullable constraint
 */
const createArrayColumn = (
  table: Knex.TableBuilder,
  column: Column
): void => {
  const baseType = column.type[0] as ColumnType;
  const config = columnTypeConfigs[baseType];
  if (!config) {
    throw new Error(`Invalid base type for array column: ${baseType}`);
  }
  
  const arrayColumn = table.specificType(column.name, `${config.sqlType}[]`);
  applyNullableConstraint(arrayColumn, column.nullable);
};

/**
 * Creates a table for the given entity
 */
const createTable = async (
  trx: Knex.Transaction,
  entity: Entity,
  schema: DatabaseSchema
): Promise<void> => {
  validatePrimaryKeyColumns(entity);

  await trx.schema.createTable(entity.name, (table) => {
    for (const column of entity.columns) {
      if (isArrayColumnType(column.type)) {
        createArrayColumn(table, column);
      } else if (schema.entities.has(column.type)) {
        // Foreign key column (references another entity)
        createForeignKeyColumn(table, column, column.type as ColumnType, schema);
      } else if (isColumnType(column.type)) {
        // Regular column
        createColumn(table, column.name, column.type, column.nullable);
      } else {
        log.warn(
          `Skipping column '${column.name}' in entity '${entity.name}': unknown type '${column.type}'`
        );
      }
    }

    // Add primary key constraint
    table.primary(entity.primaryKey);
  });

  log.info(`Created table: ${entity.name}`);
};

const createDb = async (context: AppContext, productionMode: boolean, initializeDb: boolean): Promise<string[]> => {
  const { schema, dbContext: { db } } = context;

  const schemaEntities = Array.from(schema.entities.keys());
  let entities: string[];

  return await db.transaction(async (trx) => {
    if (initializeDb) {
      // Initialize mode: Drop and recreate all tables
      log.info('Initializing database: dropping and recreating all tables');

      const entityNames = [...schemaEntities].reverse();

      // Drop all tables first
      for (const entityName of entityNames) {
        await trx.schema.dropTableIfExists(entityName);
      }

      entities = schemaEntities;
    } else {
      log.info('Checking for new tables to create');

      const existingTables = await getExistingTables(trx);
      entities = schemaEntities.filter(entityName => !existingTables.includes(entityName));
    }

    if (entities.length === 0) {
      log.info('No new tables to create');
      return [];
    }

    log.info(`Creating ${entities.length} tables: ${entities.join(', ')}`);

    // Create tables
    for (const entityName of entities) {
      const entity = schema.entities.get(entityName);
      if (entity) {
        await createTable(trx, entity, schema);
      }
    }

    return entities;
  });
};

/**
 * Gets list of existing tables in the current schema
 */
const getExistingTables = async (trx: Knex.Transaction): Promise<string[]> => {
  const result = await trx<{ table_name: string }>('information_schema.tables')
    .select('table_name')
    .whereRaw('table_schema = current_schema() AND table_type = \'BASE TABLE\'');

  return result.map((row) => row.table_name);
};

export { createDb };
