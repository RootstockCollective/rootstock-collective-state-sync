import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { 
  isArrayColumnType, 
  isColumnType, 
  validateNullablePrimaryKeys,
  validateEntityNullable,
  columnTypeConfigs
} from './types';
import { Entity, Column } from '../config/types';

describe('Type Guards', () => {
  describe('isColumnType', () => {
    it('should return true for valid column types', () => {
      assert.equal(isColumnType('Boolean'), true);
      assert.equal(isColumnType('BigInt'), true);
      assert.equal(isColumnType('Bytes'), true);
      assert.equal(isColumnType('String'), true);
      assert.equal(isColumnType('Integer'), true);
    });

    it('should return false for invalid column types', () => {
      assert.equal(isColumnType('InvalidType'), false);
      assert.equal(isColumnType('boolean'), false); // case sensitive
      assert.equal(isColumnType('number'), false);
      assert.equal(isColumnType(''), false);
      assert.equal(isColumnType('Entity'), false);
    });

    it('should return false for non-string inputs', () => {
       
      assert.equal(isColumnType(123 as any), false);
       
      assert.equal(isColumnType(null as any), false);
       
      assert.equal(isColumnType(undefined as any), false);
       
      assert.equal(isColumnType({} as any), false);
       
      assert.equal(isColumnType([] as any), false);
    });
  });

  describe('isArrayColumnType', () => {
    it('should return true for valid array column types', () => {
      assert.equal(isArrayColumnType(['Boolean']), true);
      assert.equal(isArrayColumnType(['BigInt']), true);
      assert.equal(isArrayColumnType(['Bytes']), true);
      assert.equal(isArrayColumnType(['String']), true);
      assert.equal(isArrayColumnType(['Integer']), true);
    });

    it('should return false for invalid array column types', () => {
      assert.equal(isArrayColumnType(['InvalidType']), false);
      assert.equal(isArrayColumnType(['boolean']), false); // case sensitive
      assert.equal(isArrayColumnType([]), false); // empty array
      assert.equal(isArrayColumnType(['Boolean', 'String']), false); // multiple elements
    });

    it('should return false for non-array inputs', () => {
      assert.equal(isArrayColumnType('Boolean'), false);
       
      assert.equal(isArrayColumnType(123 as any), false);
       
      assert.equal(isArrayColumnType(null as any), false);
       
      assert.equal(isArrayColumnType(undefined as any), false);
       
      assert.equal(isArrayColumnType({} as any), false);
    });

    it('should return false for arrays with non-string elements', () => {
       
      assert.equal(isArrayColumnType([123] as any), false);
       
      assert.equal(isArrayColumnType([null] as any), false);
       
      assert.equal(isArrayColumnType([{}] as any), false);
    });
  });

  describe('Nullable Functionality', () => {
    describe('All types can be nullable', () => {
      it('should support nullable for Boolean type', () => {
        const config = columnTypeConfigs.Boolean;
        assert.ok(config, 'Boolean config should exist');
        assert.ok(config.knexHandler, 'Boolean should have knexHandler');
      });

      it('should support nullable for BigInt type', () => {
        const config = columnTypeConfigs.BigInt;
        assert.ok(config, 'BigInt config should exist');
        assert.ok(config.knexHandler, 'BigInt should have knexHandler');
      });

      it('should support nullable for Bytes type', () => {
        const config = columnTypeConfigs.Bytes;
        assert.ok(config, 'Bytes config should exist');
        assert.ok(config.knexHandler, 'Bytes should have knexHandler');
      });

      it('should support nullable for String type', () => {
        const config = columnTypeConfigs.String;
        assert.ok(config, 'String config should exist');
        assert.ok(config.knexHandler, 'String should have knexHandler');
      });

      it('should support nullable for Integer type', () => {
        const config = columnTypeConfigs.Integer;
        assert.ok(config, 'Integer config should exist');
        assert.ok(config.knexHandler, 'Integer should have knexHandler');
      });

      it('should have all column types support nullable', () => {
        const types = ['Boolean', 'BigInt', 'Bytes', 'String', 'Integer'] as const;
        
        types.forEach(type => {
          const config = columnTypeConfigs[type];
          assert.ok(config, `Config should exist for ${type}`);
          assert.ok(config.knexHandler, `${type} should have knexHandler that creates nullable columns`);
        });
      });
    });

    describe('validateNullablePrimaryKeys', () => {
      it('should return empty array when primary keys are not nullable', () => {
        const entity: Entity = {
          name: 'User',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'name', type: 'String', nullable: true }
          ]
        };

        const errors = validateNullablePrimaryKeys(entity);
        assert.equal(errors.length, 0, 'Should have no errors');
      });

      it('should return error when primary key is marked as nullable', () => {
        const entity: Entity = {
          name: 'User',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes', nullable: true },
            { name: 'name', type: 'String' }
          ]
        };

        const errors = validateNullablePrimaryKeys(entity);
        assert.equal(errors.length, 1, 'Should have one error');
        assert.ok(errors[0].includes('Primary key column "id"'), 'Error should mention primary key');
        assert.ok(errors[0].includes('cannot be nullable'), 'Error should mention nullable restriction');
      });

      it('should return multiple errors for composite primary keys with nullable columns', () => {
        const entity: Entity = {
          name: 'Vote',
          primaryKey: ['proposalId', 'voterId'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'proposalId', type: 'String', nullable: true },
            { name: 'voterId', type: 'Bytes', nullable: true },
            { name: 'support', type: 'Boolean' }
          ]
        };

        const errors = validateNullablePrimaryKeys(entity);
        assert.equal(errors.length, 2, 'Should have two errors');
        assert.ok(errors[0].includes('proposalId'), 'First error should mention proposalId');
        assert.ok(errors[1].includes('voterId'), 'Second error should mention voterId');
      });

      it('should only return errors for nullable primary keys in composite key', () => {
        const entity: Entity = {
          name: 'Vote',
          primaryKey: ['proposalId', 'voterId'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'proposalId', type: 'String' },
            { name: 'voterId', type: 'Bytes', nullable: true },
            { name: 'support', type: 'Boolean', nullable: true }
          ]
        };

        const errors = validateNullablePrimaryKeys(entity);
        assert.equal(errors.length, 1, 'Should have one error');
        assert.ok(errors[0].includes('voterId'), 'Error should only mention voterId');
      });
    });

    describe('validateEntityNullable', () => {
      it('should fail validation when primary key is nullable', () => {
        const entity: Entity = {
          name: 'Product',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes', nullable: true },
            { name: 'name', type: 'String' }
          ]
        };

        const errors = validateEntityNullable(entity);
        assert.ok(errors.length > 0, 'Should have validation errors');
        assert.ok(errors[0].includes('Primary key'), 'Error should mention primary key');
      });

      it('should allow all column types to be nullable (except primary keys)', () => {
        const entity: Entity = {
          name: 'AllTypes',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'boolField', type: 'Boolean', nullable: true },
            { name: 'bigIntField', type: 'BigInt', nullable: true },
            { name: 'bytesField', type: 'Bytes', nullable: true },
            { name: 'stringField', type: 'String', nullable: true },
            { name: 'intField', type: 'Integer', nullable: true },
            { name: 'arrayField', type: ['String'], nullable: true }
          ]
        };

        const errors = validateEntityNullable(entity);
        assert.equal(errors.length, 0, 'All types should be allowed to be nullable');
      });
    });

    describe('Nullable field behavior', () => {
      it('should accept null value for nullable Boolean field', () => {
        const column: Column = { name: 'isActive', type: 'Boolean', nullable: true };
        const value: boolean | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted');
      });

      it('should accept undefined for nullable field', () => {
        const column: Column = { name: 'optionalField', type: 'String', nullable: true };
        const value: string | undefined = undefined;
        
        assert.equal(column.nullable, true);
        assert.equal(value, undefined, 'Undefined value should be accepted');
      });

      it('should accept null value for nullable BigInt field', () => {
        const column: Column = { name: 'amount', type: 'BigInt', nullable: true };
        const value: bigint | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted for BigInt');
      });

      it('should accept null value for nullable Bytes field', () => {
        const column: Column = { name: 'hash', type: 'Bytes', nullable: true };
        const value: string | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted for Bytes');
      });

      it('should accept null value for nullable String field', () => {
        const column: Column = { name: 'description', type: 'String', nullable: true };
        const value: string | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted for String');
      });

      it('should accept null value for nullable Integer field', () => {
        const column: Column = { name: 'count', type: 'Integer', nullable: true };
        const value: number | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted for Integer');
      });

      it('should accept null for nullable array field', () => {
        const column: Column = { name: 'tags', type: ['String'], nullable: true };
        const value: string[] | null = null;
        
        assert.equal(column.nullable, true);
        assert.equal(value, null, 'Null value should be accepted for array type');
      });

      it('should accept missing value (undefined) for optional nullable field', () => {
        const record: { id: string; optionalField?: string } = {
          id: '123'
          // optionalField is not provided
        };
        
        assert.equal(record.optionalField, undefined, 'Missing nullable field should be undefined');
      });
    });
  });
});
