import log from 'loglevel';
import { App, Column, Entity } from '../config/types';
import { columnTypeMap, isColumnType, isArrayColumnType, ColumnType } from './types';
import { AppContext } from '../context/types';
import { Knex } from 'knex';
import { DatabaseSchema } from '../context/schema';

const getReferencedIdColumnType = (schema: DatabaseSchema, column: Column): ColumnType[] => {
    const referencedEntity = schema.entities.get(column.type);
    if (!referencedEntity) {
        throw new Error(`Referenced entity ${column.type} not found in schema`);
    }

    const idColumns = referencedEntity.primaryKey.map(key => referencedEntity.columns.find(col => col.name === key));
    if (!idColumns || !idColumns.every(col => col && isColumnType(col.type))) {
        throw new Error(`Invalid id column type in referenced entity ${column.type}`);
    }

    return idColumns.map(col => col!.type);
}

const columnTypeHandlers: Record<ColumnType, (table: Knex.TableBuilder, name: string) => Knex.ColumnBuilder> = {
    BigInt: (table, name) => table.text(name).notNullable(),
    Bytes: (table, name) => table.binary(name).notNullable(),
    String: (table, name) => table.text(name).notNullable(),
    Boolean: (table, name) => table.boolean(name).notNullable(),
};

const createColumn = (table: Knex.TableBuilder, name: string, type: ColumnType) => {
    const handler = columnTypeHandlers[type];
    if (!handler) {
        log.error(`Invalid column type: ${type}`);
        throw new Error(`Invalid column type: ${type}`);
    }
    handler(table, name);
}

const createTable = async (trx: Knex.Transaction, entity: Entity, schema: DatabaseSchema): Promise<void> => {
    await trx.schema.createTable(entity.name, (table) => {
        for (const column of entity.columns) {
            if (schema.entities.has(column.type)) {
                const referencedType = getReferencedIdColumnType(schema, column);
                for (const type of referencedType) {
                    createColumn(table, column.name, type);
                    table.foreign(column.name)
                        .references('id')
                        .inTable(column.type)
                        .onDelete('CASCADE');
                }
            }
            else if (isColumnType(column.type)) {
                createColumn(table, column.name, column.type);
            } else if (isArrayColumnType(column.type)) {
                const baseType = column.type[0];
                table.specificType(column.name, `${columnTypeMap[baseType]}[]`).notNullable();
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
}

const createDb = async (context: AppContext, appConfig: App): Promise<string[]> => {
    const { schema, dbContext: { db } } = context;

    const { productionMode, initializeDb } = appConfig;

    const schemaEntities = Array.from(schema.entities.keys());
    let entities: string[];

    return await db.transaction(async (trx) => {
        if (initializeDb) {
            if (productionMode) {
                throw new Error('Cannot initialize database in production mode. Set `initializeDb: false` in app config.');
            }

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
}

const getExistingTables = async (db: Knex): Promise<string[]> => {
    const result = await db<{ table_name: string }>('information_schema.tables')
        .select('table_name')
        .where('table_schema', 'public')
        .andWhere('table_type', 'BASE TABLE');

    return result.map((row) => row.table_name);
}

export { createDb }