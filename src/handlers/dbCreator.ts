import { Column, Entity } from '../config/types';
import { DatabaseSchema, columnTypeMap, isColumnType, isArrayColumnType, ColumnType } from './types';
import { AppContext } from '../context/types';
import { Knex } from 'knex';
import log from 'loglevel';

// Pure function to get referenced entity's id column type
const getReferencedIdColumnType = (schema: DatabaseSchema, column: Column): ColumnType => {
    const referencedEntity = schema.entities.get(column.type);
    if (!referencedEntity) {
        throw new Error(`Referenced entity ${column.type} not found in schema`);
    }

    const idColumn = referencedEntity.columns.find((col: Column) => col.name === 'id');
    if (!idColumn || !isColumnType(idColumn.type)) {
        throw new Error(`Invalid id column type in referenced entity ${column.type}`);
    }

    return idColumn.type;
};

const createColumn = (table: Knex.TableBuilder, name: string, type: ColumnType) => {
    switch (type.toLowerCase()) {
        case 'integer':
            table.integer(name).notNullable();
            break;
        case 'bigint':
            table.text(name).notNullable();
            break;
        case 'text':
            table.text(name).notNullable();
            break;
        case 'boolean':
            table.boolean(name).notNullable();
            break;
        case 'timestamp':
            table.timestamp(name).notNullable();
            break;
        case "bytes":
            table.binary(name).notNullable();
            break;
        default:
            table.string(name).notNullable();
    }
};

// Helper function to create a single table
const createTable = async (db: Knex, entity: Entity, schema: DatabaseSchema): Promise<void> => {
    await db.schema.createTable(entity.name, (table) => {
        // Add columns
        for (const column of entity.columns) {
            if (schema.entities.has(column.type)) {
                const referencedType = getReferencedIdColumnType(schema, column);
                createColumn(table, column.name, referencedType);
                table.foreign(column.name)
                    .references('id')
                    .inTable(column.type)
                    .onDelete('CASCADE');
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
};

// Function to create database
export const createDb = async (context: AppContext, initializeDb: boolean): Promise<string[]> => {
    const { schema, dbContext: { db } } = context;

    const schemaEntities = Array.from(schema.entities.keys());
    let entities: string[];

    if (initializeDb) {
        // Initialize mode: Drop and recreate all tables
        log.info('Initializing database: dropping and recreating all tables');

        const entityNames = [...schemaEntities].reverse();

        // Drop all tables first
        for (const entityName of entityNames) {
            await db.schema.dropTableIfExists(entityName);
        }

        entities = schemaEntities;
    } else {
        log.info('Checking for new tables to create');

        const existingTables = await getExistingTables(db);
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
            await createTable(db, entity, schema);
        }
    }

    return entities;
};

// Helper function to get existing table names from the database
const getExistingTables = async (db: Knex): Promise<string[]> => {
    const result = await db<{ table_name: string }>('information_schema.tables')
        .select('table_name')
        .where('table_schema', 'public')
        .andWhere('table_type', 'BASE TABLE');

    return result.map((row) => row.table_name);
};
