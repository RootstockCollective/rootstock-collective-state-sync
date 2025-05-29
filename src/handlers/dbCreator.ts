import { Column } from '../config/types';
import { DatabaseSchema, columnTypeMap, isColumnType, isArrayColumnType, ColumnType } from './types';
import { AppContext } from '../context/types';
import { Knex } from 'knex';

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

// Function to create database
export const createDb = async (context: AppContext): Promise<void> => {
    const { schema, dbContext } = context;
    const { db } = dbContext;

    const keys = Array.from(schema.entities.keys()).reverse();

    // Drop all tables first
    for (const entityName of keys) {
        await db.schema.dropTableIfExists(entityName);
    }

    // Create tables
    for (const entity of schema.entities.values()) {
        await db.schema.createTable(entity.name, (table) => {
            // Add columns
            for (const column of entity.columns) {
                if (column.references) continue; // Skip reference columns as they'll be handled by foreign keys

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
            }

            // Add primary key
            table.primary(entity.primaryKeys);
        });
    }
};