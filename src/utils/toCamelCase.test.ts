import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCamelCase } from './toCamelCase';

describe('toCamelCase', () => {
  it('should convert PascalCase to camelCase', () => {
    assert.equal(toCamelCase('BlockChangeLog'), 'blockChangeLog');
    assert.equal(toCamelCase('Entity'), 'entity');
    assert.equal(toCamelCase('MyEntity'), 'myEntity');
  });

  it('should handle single character strings', () => {
    assert.equal(toCamelCase('A'), 'a');
    assert.equal(toCamelCase('Z'), 'z');
  });

  it('should handle already camelCase strings', () => {
    assert.equal(toCamelCase('alreadyCamelCase'), 'alreadyCamelCase');
    assert.equal(toCamelCase('test'), 'test');
  });

  it('should handle empty string', () => {
    assert.equal(toCamelCase(''), '');
  });

  it('should handle all lowercase strings', () => {
    assert.equal(toCamelCase('lowercase'), 'lowercase');
  });

  it('should handle all uppercase strings', () => {
    assert.equal(toCamelCase('UPPERCASE'), 'uPPERCASE');
  });

  it('should handle strings with numbers', () => {
    assert.equal(toCamelCase('Entity123'), 'entity123');
    assert.equal(toCamelCase('123Entity'), '123Entity');
  });
});

