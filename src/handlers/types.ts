import { Knex } from 'knex';

type ColumnType = 'Boolean' | 'BigInt' | 'Bytes' | 'String' | 'Integer';
type ArrayColumnType = [ColumnType];

interface ColumnTypeConfig {
    sqlType: string;
    knexHandler: (table: Knex.TableBuilder, name: string) => Knex.ColumnBuilder;
}

const columnTypeConfigs: Record<ColumnType, ColumnTypeConfig> = {
    Boolean: {
        sqlType: 'BOOLEAN',
        knexHandler: (table, name) => table.boolean(name).notNullable()
    },
    BigInt: {
        sqlType: 'NUMERIC',
        knexHandler: (table, name) => table.decimal(name, 78, 0).notNullable()
    },
    Bytes: {
        sqlType: 'BYTEA',
        knexHandler: (table, name) => table.binary(name).notNullable()
    },
    String: {
        sqlType: 'TEXT',
        knexHandler: (table, name) => table.text(name).notNullable()
    },
    Integer: {
        sqlType: 'INTEGER',
        knexHandler: (table, name) => table.integer(name).notNullable()
    }
} as const;

const isColumnType = (type: string): type is ColumnType =>
    Object.keys(columnTypeConfigs).includes(type);

const isArrayColumnType = (type: string | string[]): type is ArrayColumnType => {
    return Array.isArray(type) &&
        type.length === 1 &&
        typeof type[0] === "string" &&
        isColumnType(type[0]);
}



type EntityRecord = unknown & { id: string };
type EntityDataCollection = Record<string, EntityRecord[]>;

export type { ColumnType, ArrayColumnType, EntityDataCollection, EntityRecord, ColumnTypeConfig }
export { columnTypeConfigs, isColumnType, isArrayColumnType }
