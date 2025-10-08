import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isArrayColumnType, isColumnType } from './types';

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
});

