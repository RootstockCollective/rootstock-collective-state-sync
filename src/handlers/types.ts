import { Knex } from 'knex';
import { GraphQLMetadata } from '../context/subgraphProvider';

type ColumnType = 'Boolean' | 'BigInt' | 'Bytes' | 'String' | 'Integer';
type ArrayColumnType = [ColumnType];

interface ColumnTypeConfig {
    sqlType: string;
    knexHandler: (table: Knex.TableBuilder, name: string) => Knex.ColumnBuilder;
}

const columnTypeConfigs: Record<ColumnType, ColumnTypeConfig> = {
  Boolean: {
    sqlType: 'BOOLEAN',
    knexHandler: (table, name) => table.boolean(name)
  },
  BigInt: {
    sqlType: 'NUMERIC',
    knexHandler: (table, name) => table.decimal(name, 78, 0)
  },
  Bytes: {
    sqlType: 'BYTEA',
    knexHandler: (table, name) => table.binary(name)
  },
  String: {
    sqlType: 'TEXT',
    knexHandler: (table, name) => table.text(name)
  },
  Integer: {
    sqlType: 'INTEGER',
    knexHandler: (table, name) => table.integer(name)
  }
} as const;

const isColumnType = (type: string): type is ColumnType =>
  Object.keys(columnTypeConfigs).includes(type);

const isArrayColumnType = (type: string | string[]): type is ArrayColumnType => {
  return Array.isArray(type) &&
        type.length === 1 &&
        typeof type[0] === 'string' &&
        isColumnType(type[0]);
};

type EntityRecord = unknown & { id: string };

type WithMetadata = true;
type EntityDataCollection<WMeta extends boolean = false> = WMeta extends WithMetadata ?
    Record<string, EntityRecord[]> & { _meta: GraphQLMetadata } : Record<string, EntityRecord[]>;

export { columnTypeConfigs, isArrayColumnType, isColumnType };
export type { ArrayColumnType, ColumnType, ColumnTypeConfig, EntityDataCollection, EntityRecord, WithMetadata };
