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

    it('should preserve nullable property for nullable columns', () => {
      const entity: Entity = {
        name: 'NullableTest',
        primaryKey: ['id'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'id', type: 'String' },
          { name: 'optionalField', type: 'String', nullable: true },
          { name: 'requiredField', type: 'String', nullable: false }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('NullableTest');

      assert.ok(retrieved);
      assert.equal(retrieved.columns[0].nullable, undefined); // id has no nullable property
      assert.equal(retrieved.columns[1].nullable, true); // optionalField is nullable
      assert.equal(retrieved.columns[2].nullable, false); // requiredField is explicitly not nullable
    });

    it('should preserve nullable property for nullable array columns', () => {
      const entity: Entity = {
        name: 'NullableArrayTest',
        primaryKey: ['id'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'id', type: 'String' },
          { name: 'nullableTags', type: ['String'], nullable: true },
          { name: 'requiredTags', type: ['String'], nullable: false }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('NullableArrayTest');

      assert.ok(retrieved);
      assert.equal(retrieved.columns[1].nullable, true); // nullableTags is nullable
      assert.equal(retrieved.columns[2].nullable, false); // requiredTags is explicitly not nullable
    });

    it('should handle entities with mix of nullable and non-nullable columns', () => {
      const entity: Entity = {
        name: 'MixedNullable',
        primaryKey: ['id'],
        subgraphProvider: 'mainProvider',
        columns: [
          { name: 'id', type: 'Bytes' },
          { name: 'name', type: 'String' }, // no nullable property (defaults to not nullable)
          { name: 'description', type: 'String', nullable: true },
          { name: 'tags', type: ['String'] }, // array without nullable (defaults to not nullable)
          { name: 'metadata', type: ['String'], nullable: true },
          { name: 'count', type: 'Integer', nullable: false }
        ]
      };

      const schema = createSchemaContext([entity]);
      const retrieved = schema.entities.get('MixedNullable');

      assert.ok(retrieved);
      assert.equal(retrieved.columns.length, 6);
      assert.equal(retrieved.columns[0].nullable, undefined); // id
      assert.equal(retrieved.columns[1].nullable, undefined); // name (default)
      assert.equal(retrieved.columns[2].nullable, true); // description
      assert.equal(retrieved.columns[3].nullable, undefined); // tags (default)
      assert.equal(retrieved.columns[4].nullable, true); // metadata
      assert.equal(retrieved.columns[5].nullable, false); // count
    });
  });
});
