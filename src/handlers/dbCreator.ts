import { Knex } from 'knex';
import log from 'loglevel';
import { Column, Entity } from '../config/types';
import { DatabaseSchema } from '../context/schema';
import { AppContext } from '../context/types';
import { ColumnType, columnTypeConfigs, isArrayColumnType, isColumnType } from './types';

const getReferencedIdColumnType = (schema: DatabaseSchema, column: Column): ColumnType[] => {
  const referencedEntity = schema.entities.get(column.type);
  if (!referencedEntity) {
    throw new Error(`Referenced entity ${column.type} not found in schema`);
  }

  const idColumns = referencedEntity.primaryKey.map(key => {
    const col = referencedEntity.columns.find(col => col.name === key);
    if (!col) {
      throw new Error(`Primary key column '${key}' not found in entity ${column.type}`);
    }
    if (!isColumnType(col.type)) {
      throw new Error(`Invalid column type for primary key '${key}' in entity ${column.type}`);
    }
    return col;
  });

  return idColumns.map(col => col.type);
};

const createColumn = (table: Knex.TableBuilder, name: string, type: ColumnType, nullable = false) => {
  const config = columnTypeConfigs[type];
  if (!config) {
    log.error(`Invalid column type: ${type}`);
    throw new Error(`Invalid column type: ${type}`);
  }
  
  if (nullable) {
    if (!config.knexHandlerNullable) {
      throw new Error(`Column type ${type} does not support nullable option`);
    }
    config.knexHandlerNullable(table, name);
  } else {
    config.knexHandler(table, name);
  }
};

const createTable = async (trx: Knex.Transaction, entity: Entity, schema: DatabaseSchema): Promise<void> => {
  await trx.schema.createTable(entity.name, (table) => {
    for (const column of entity.columns) {
      const nullable = column.nullable ?? false;
      if (schema.entities.has(column.type)) {
        const referencedType = getReferencedIdColumnType(schema, column);
        for (const type of referencedType) {
          createColumn(table, column.name, type, nullable);
          table.foreign(column.name)
            .references('id')
            .inTable(column.type)
            .onDelete('CASCADE');
        }
      }
      else if (isColumnType(column.type)) {
        createColumn(table, column.name, column.type, nullable);
      } else if (isArrayColumnType(column.type)) {
        const baseType = column.type[0] as ColumnType;
        const config = columnTypeConfigs[baseType];
        const col = table.specificType(column.name, `${config.sqlType}[]`);
        if (!nullable) {
          col.notNullable();
        }
      }
      else {
        log.error(`Invalid column type: ${column.type}`);
        throw new Error(`Invalid column type: ${column.type}`);
      }
    }

    // Add primary key
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

const getExistingTables = async (db: Knex): Promise<string[]> => {
  const result = await db<{ table_name: string }>('information_schema.tables')
    .select('table_name')
    .whereRaw('table_schema = current_schema() AND table_type = \'BASE TABLE\'');

  return result.map((row) => row.table_name);
};

export { createDb };
