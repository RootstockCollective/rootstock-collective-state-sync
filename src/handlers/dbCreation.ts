import { Column } from '../config/config';
import { DatabaseSchema, columnTypeMap, isColumnType, isArrayColumnType, ColumnType } from './types';
import { Entity } from '../config/config';
import { AppContext } from '../context/types';

// Pure function to get referenced entity's id column type
const getReferencedIdColumnType = (schema: DatabaseSchema, column: Column): string => {
    const referencedEntity = schema.entities.get(column.type);
    if (!referencedEntity) {
        throw new Error(`Referenced entity ${column.type} not found in schema`);
    }

    const idColumn = referencedEntity.columns.find((col: Column) => col.name === 'id');
    if (!idColumn || !isColumnType(idColumn.type)) {
        throw new Error(`Invalid id column type in referenced entity ${column.type}`);
    }

    return columnTypeMap[idColumn.type as ColumnType];
};

// Pure function to generate column definition
const generateColumnDefinition = (column: Column, schema: DatabaseSchema): string => {
    if (column.references) return '';

    if (schema.entities.has(column.type)) {
        return `"${column.name}" ${getReferencedIdColumnType(schema, column)} NOT NULL`;
    }

    if (isArrayColumnType(column.type)) {
        return `"${column.name}" ${columnTypeMap[column.type[0]]}[] NOT NULL`;
    }

    if (!isColumnType(column.type)) {
        throw new Error(`Invalid column type ${column.type} for column ${column.name}`);
    }

    return `"${column.name}" ${columnTypeMap[column.type]} NOT NULL`;
};

// Pure function to generate primary key constraint
const generatePrimaryKey = (primaryKeys: string[]): string =>
    `PRIMARY KEY (${primaryKeys.map(key => `"${key}"`).join(', ')})`;

// Pure function to generate drop tables query
const generateDropTables = (schema: DatabaseSchema): string[] => {
    const tableNames = Array.from(schema.entities.keys())
        .map(name => `"${name}"`)
        .join(', ');
    return [`DROP TABLE IF EXISTS ${tableNames} CASCADE;`];
};

// Pure function to generate create table query
const generateCreateTable = (entity: Entity, schema: DatabaseSchema): string => {
    const columnDefinitions = entity.columns
        .map(column => generateColumnDefinition(column, schema))
        .filter(Boolean);

    return `CREATE TABLE IF NOT EXISTS "${entity.name}" (${[...columnDefinitions, generatePrimaryKey(entity.primaryKeys)].join(', ')})`;
};

// Pure function to generate create tables queries
const generateCreateTables = (schema: DatabaseSchema): string[] =>
    Array.from(schema.entities.values())
        .map(entity => generateCreateTable(entity, schema));

// Pure function to generate foreign key constraint
const generateForeignKeyConstraint = (column: Column, entity: Entity): string => {
    const foreignKeyColumns = column.references!.map(ref => `${ref}`).join(', ');
    return `ALTER TABLE "${column.type}" ADD CONSTRAINT "fk_${column.type}" FOREIGN KEY (${foreignKeyColumns}) REFERENCES "${entity.name}"(id);`;
};

// Pure function to generate foreign key queries
const generateForeignKeys = (schema: DatabaseSchema): string[] =>
    Array.from(schema.entities.values())
        .flatMap(entity =>
            entity.columns
                .filter(column => column.references)
                .map(column => generateForeignKeyConstraint(column, entity))
        );

// Pure function to generate all database queries
const generateQueries = (schema: DatabaseSchema): string[] => [
    ...generateDropTables(schema),
    ...generateCreateTables(schema),
    ...generateForeignKeys(schema)
];

// Function to create database
export const createDb = async (context: AppContext): Promise<void> => {
    const { dbContext, schema } = context;
    const queries = generateQueries(schema);
    await dbContext.pool.query(queries.join(';'));
};