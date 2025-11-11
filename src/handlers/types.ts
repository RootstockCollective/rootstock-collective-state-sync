import { Knex } from 'knex';
import { GraphQLMetadata } from '../context/subgraphProvider';
import { Entity } from '../config/types';

type ColumnType = 'Boolean' | 'BigInt' | 'Bytes' | 'String' | 'Integer';
type ArrayColumnType = [ColumnType];

interface ColumnTypeConfig {
    sqlType: string;
    knexHandler: (table: Knex.TableBuilder, name: string) => Knex.ColumnBuilder;
}

const columnTypeConfigs: Record<ColumnType, ColumnTypeConfig> = {
  Boolean: {
    sqlType: 'BOOLEAN',
    knexHandler: (table, name) => table.boolean(name).nullable()
  },
  BigInt: {
    sqlType: 'NUMERIC',
    knexHandler: (table, name) => table.decimal(name, 78, 0).nullable()
  },
  Bytes: {
    sqlType: 'BYTEA',
    knexHandler: (table, name) => table.binary(name).nullable()
  },
  String: {
    sqlType: 'TEXT',
    knexHandler: (table, name) => table.text(name).nullable()
  },
  Integer: {
    sqlType: 'INTEGER',
    knexHandler: (table, name) => table.integer(name).nullable()
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

// Validates that primary key columns are not marked as nullable
const validateNullablePrimaryKeys = (entity: Entity): string[] => {
  const errors: string[] = [];
  
  for (const pkName of entity.primaryKey) {
    const column = entity.columns.find(col => col.name === pkName);
    if (column && column.nullable === true) {
      errors.push(`Primary key column "${pkName}" in entity "${entity.name}" cannot be nullable`);
    }
  }
  
  return errors;
};

//Validates an entity's nullable configuration
const validateEntityNullable = (entity: Entity): string[] => {
  const errors: string[] = [];
  
  errors.push(...validateNullablePrimaryKeys(entity));
  
  return errors;
};

type EntityRecord = unknown & { id: string };

type WithMetadata = true;
type EntityDataCollection<WMeta extends boolean = false> = WMeta extends WithMetadata ?
    Record<string, EntityRecord[]> & { _meta: GraphQLMetadata } : Record<string, EntityRecord[]>;

export { 
  columnTypeConfigs, 
  isArrayColumnType, 
  isColumnType, 
  validateNullablePrimaryKeys,
  validateEntityNullable
};
export type { ArrayColumnType, ColumnType, ColumnTypeConfig, EntityDataCollection, EntityRecord, WithMetadata };

