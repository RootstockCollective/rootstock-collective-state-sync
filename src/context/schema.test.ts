import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Entity } from '../config/types';
import { createSchemaContext } from './schema';

describe('Schema Context', () => {
  describe('createSchemaContext', () => {
    it('should create a schema context from entity array', () => {
      const entities: Entity[] = [
        {
          name: 'BlockChangeLog',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'blockNumber', type: 'BigInt' }
          ]
        },
        {
          name: 'Proposal',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'String' },
            { name: 'state', type: 'String' }
          ]
        }
      ];

      const schema = createSchemaContext(entities);

      assert.ok(schema.entities instanceof Map);
      assert.equal(schema.entities.size, 2);
      assert.ok(schema.entities.has('BlockChangeLog'));
      assert.ok(schema.entities.has('Proposal'));
    });

    it('should handle empty entity array', () => {
      const schema = createSchemaContext([]);

      assert.ok(schema.entities instanceof Map);
      assert.equal(schema.entities.size, 0);
    });

    it('should properly map entity names to entities', () => {
      const entity: Entity = {
        name: 'Builder',
        primaryKey: ['id'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'id', type: 'Bytes' },
          { name: 'name', type: 'String' },
          { name: 'activated', type: 'Boolean' }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('Builder');

      assert.ok(retrieved);
      assert.equal(retrieved.name, 'Builder');
      assert.equal(retrieved.columns.length, 3);
      assert.deepEqual(retrieved.primaryKey, ['id']);
    });

    it('should handle entities with composite primary keys', () => {
      const entity: Entity = {
        name: 'Vote',
        primaryKey: ['proposalId', 'voterId'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'proposalId', type: 'String' },
          { name: 'voterId', type: 'Bytes' },
          { name: 'support', type: 'Boolean' }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('Vote');

      assert.ok(retrieved);
      assert.deepEqual(retrieved.primaryKey, ['proposalId', 'voterId']);
    });

    it('should handle entities with array column types', () => {
      const entity: Entity = {
        name: 'MultiValue',
        primaryKey: ['id'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'id', type: 'String' },
          { name: 'tags', type: ['String'] },
          { name: 'values', type: ['BigInt'] }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('MultiValue');

      assert.ok(retrieved);
      assert.ok(Array.isArray(retrieved.columns[1].type));
      assert.deepEqual(retrieved.columns[1].type, ['String']);
    });

    it('should overwrite duplicate entity names', () => {
      const entity1: Entity = {
        name: 'Duplicate',
        primaryKey: ['id'],
        subgraphProvider: 'provider1',
        columns: [{ name: 'id', type: 'String' }]
      };

      const entity2: Entity = {
        name: 'Duplicate',
        primaryKey: ['otherId'],
        subgraphProvider: 'provider2',
        columns: [
          { name: 'otherId', type: 'String' },
          { name: 'extra', type: 'String' }
        ]
      };

      const schema = createSchemaContext([entity1, entity2]);

      assert.equal(schema.entities.size, 1);
      const retrieved = schema.entities.get('Duplicate');
      assert.ok(retrieved);
      // Should have the second entity's data
      assert.equal(retrieved.columns.length, 2);
      assert.deepEqual(retrieved.primaryKey, ['otherId']);
    });

    it('should be immutable - pure function', () => {
      const entities: Entity[] = [
        {
          name: 'Test',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'String' }]
        }
      ];

      const schema1 = createSchemaContext(entities);
      const schema2 = createSchemaContext(entities);

      // Should create new Map instances
      assert.notEqual(schema1.entities, schema2.entities);
      assert.equal(schema1.entities.size, schema2.entities.size);
    });
  });
});

