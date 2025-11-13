import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import knex, { Knex } from 'knex';
import { Column } from '../config/types';
import { ArrayColumnType } from './types';
import { applyNullableConstraint, createArrayColumn, createColumn } from './dbCreator';

describe('dbCreator nullable handling', () => {
  describe('applyNullableConstraint', () => {
    const createMockBuilder = () => {
      const calls = { nullable: 0, notNullable: 0 };
      const builder = {
        nullable() {
          calls.nullable += 1;
          return this;
        },
        notNullable() {
          calls.notNullable += 1;
          return this;
        }
      } as unknown as Knex.ColumnBuilder;
      return { builder, calls };
    };

    it('marks column as nullable when flag is true', () => {
      const { builder, calls } = createMockBuilder();

      applyNullableConstraint(builder, true);

      assert.equal(calls.nullable, 1);
      assert.equal(calls.notNullable, 0);
    });

    it('marks column as not nullable when flag is false or omitted', () => {
      const falseCase = createMockBuilder();
      applyNullableConstraint(falseCase.builder, false);
      assert.equal(falseCase.calls.nullable, 0);
      assert.equal(falseCase.calls.notNullable, 1);

      const defaultCase = createMockBuilder();
      applyNullableConstraint(defaultCase.builder);
      assert.equal(defaultCase.calls.nullable, 0);
      assert.equal(defaultCase.calls.notNullable, 1);
    });
  });

  describe('column creation helpers', () => {
    let knexInstance: Knex;

    const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').toLowerCase();

    before(() => {
      knexInstance = knex({ client: 'pg' });
    });

    after(async () => {
      await knexInstance.destroy();
    });

    it('creates scalar columns with correct nullable constraints', () => {
      const statements = knexInstance.schema.createTable('nullable_scalar_helper', (table) => {
        createColumn(table, 'nullable_field', 'String', true);
        createColumn(table, 'required_field', 'String', false);
        createColumn(table, 'default_field', 'String');
      }).toSQL();

      const createSql = normalizeSql(statements[0].sql);

      assert.ok(createSql.includes('"nullable_field" text'));
      assert.ok(!createSql.includes('"nullable_field" text not null'));
      assert.ok(createSql.includes('"required_field" text not null'));
      assert.ok(createSql.includes('"default_field" text not null'));
    });

    it('creates array columns with correct nullable constraints', () => {
      const statements = knexInstance.schema.createTable('nullable_array_helper', (table) => {
        const nullableColumn: Column = { name: 'nullable_tags', type: ['String'] as ArrayColumnType, nullable: true };
        const requiredColumn: Column = { name: 'required_tags', type: ['String'] as ArrayColumnType, nullable: false };
        const defaultColumn: Column = { name: 'default_tags', type: ['String'] as ArrayColumnType };

        createArrayColumn(table, nullableColumn);
        createArrayColumn(table, requiredColumn);
        createArrayColumn(table, defaultColumn);
      }).toSQL();

      const createSql = normalizeSql(statements[0].sql);

      assert.ok(createSql.includes('"nullable_tags" text[]'));
      assert.ok(!createSql.includes('"nullable_tags" text[] not null'));
      assert.ok(createSql.includes('"required_tags" text[] not null'));
      assert.ok(createSql.includes('"default_tags" text[] not null'));
    });
  });
});

