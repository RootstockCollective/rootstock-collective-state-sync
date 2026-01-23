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

    it('should handle entities with composite primary keys in schema (but database creation will reject them)', () => {
      // Note: Schema creation allows composite keys, but database creation via dbCreator
      // will reject them because EntityChangeLog and subgraph protocol don't support composite keys
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

  describe('getUpsertOrder', () => {
    it('should return entities in FK-safe order (parents before children)', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' }
          ]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any } // FK to Builder
          ]
        },
        {
          name: 'BackerToBuilder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builderState', type: 'BuilderState' as any } // FK to BuilderState
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const order = schema.getUpsertOrder();

      // Builder should come before BuilderState, BuilderState before BackerToBuilder
      const builderIndex = order.indexOf('Builder');
      const builderStateIndex = order.indexOf('BuilderState');
      const backerToBuilderIndex = order.indexOf('BackerToBuilder');

      assert.ok(builderIndex < builderStateIndex, 'Builder should come before BuilderState');
      assert.ok(builderStateIndex < backerToBuilderIndex, 'BuilderState should come before BackerToBuilder');
    });

    it('should filter to only specified entities while maintaining FK order', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        },
        {
          name: 'OtherEntity',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        }
      ];

      const schema = createSchemaContext(entities);
      const order = schema.getUpsertOrder(['BuilderState', 'Builder']);

      assert.equal(order.length, 2);
      assert.equal(order[0], 'Builder');
      assert.equal(order[1], 'BuilderState');
    });

    it('should handle entities with no FK dependencies', () => {
      const entities: Entity[] = [
        {
          name: 'Entity1',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'Entity2',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        }
      ];

      const schema = createSchemaContext(entities);
      const order = schema.getUpsertOrder();

      assert.equal(order.length, 2);
      assert.ok(order.includes('Entity1'));
      assert.ok(order.includes('Entity2'));
    });

    it('should ignore array column types as FK dependencies', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'tags', type: ['String'] } // Array type, not FK
          ]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any } // FK to Builder
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const order = schema.getUpsertOrder();

      // Builder should come before BuilderState due to FK
      const builderIndex = order.indexOf('Builder');
      const builderStateIndex = order.indexOf('BuilderState');
      assert.ok(builderIndex < builderStateIndex);
    });
  });

  describe('getDeleteOrder', () => {
    it('should return entities in reverse FK-safe order (children before parents)', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        },
        {
          name: 'BackerToBuilder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builderState', type: 'BuilderState' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const deleteOrder = schema.getDeleteOrder();

      // BackerToBuilder should come before BuilderState, BuilderState before Builder
      const builderIndex = deleteOrder.indexOf('Builder');
      const builderStateIndex = deleteOrder.indexOf('BuilderState');
      const backerToBuilderIndex = deleteOrder.indexOf('BackerToBuilder');

      assert.ok(backerToBuilderIndex < builderStateIndex, 'BackerToBuilder should come before BuilderState');
      assert.ok(builderStateIndex < builderIndex, 'BuilderState should come before Builder');
    });

    it('should be reverse of getUpsertOrder', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const upsertOrder = schema.getUpsertOrder();
      const deleteOrder = schema.getDeleteOrder();

      assert.deepEqual(deleteOrder, upsertOrder.slice().reverse());
    });
  });

  describe('getDirectChildren', () => {
    it('should return direct children of an entity', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        },
        {
          name: 'BackerToBuilder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builderState', type: 'BuilderState' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const builderChildren = schema.getDirectChildren('Builder');
      const builderStateChildren = schema.getDirectChildren('BuilderState');

      assert.equal(builderChildren.length, 1);
      assert.equal(builderChildren[0].childEntityName, 'BuilderState');
      assert.equal(builderChildren[0].fkColumnName, 'builder');

      assert.equal(builderStateChildren.length, 1);
      assert.equal(builderStateChildren[0].childEntityName, 'BackerToBuilder');
      assert.equal(builderStateChildren[0].fkColumnName, 'builderState');
    });

    it('should return empty array for entity with no children', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        }
      ];

      const schema = createSchemaContext(entities);
      const children = schema.getDirectChildren('Builder');

      assert.equal(children.length, 0);
    });

    it('should return multiple children if entity has multiple child entities', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        },
        {
          name: 'BuilderHistory',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const children = schema.getDirectChildren('Builder');

      assert.equal(children.length, 2);
      const childNames = children.map(c => c.childEntityName).sort();
      assert.deepEqual(childNames, ['BuilderHistory', 'BuilderState']);
    });

    it('should ignore array column types', () => {
      const entities: Entity[] = [
        {
          name: 'Builder',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'tags', type: ['String'] } // Array type, not FK
          ]
        },
        {
          name: 'BuilderState',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'builder', type: 'Builder' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);
      const builderChildren = schema.getDirectChildren('Builder');

      // Should only find BuilderState, not treat tags array as a child
      assert.equal(builderChildren.length, 1);
      assert.equal(builderChildren[0].childEntityName, 'BuilderState');
    });
  });

  describe('FK cycle detection', () => {
    it('should throw error when FK cycle is detected', () => {
      const entities: Entity[] = [
        {
          name: 'EntityA',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'refB', type: 'EntityB' as any }
          ]
        },
        {
          name: 'EntityB',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'refA', type: 'EntityA' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);

      assert.throws(() => {
        schema.getUpsertOrder();
      }, /Schema FK cycle detected/);
    });

    it('should throw error with cycle entity names in error message', () => {
      const entities: Entity[] = [
        {
          name: 'EntityA',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'refB', type: 'EntityB' as any }
          ]
        },
        {
          name: 'EntityB',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'refA', type: 'EntityA' as any }
          ]
        }
      ];

      const schema = createSchemaContext(entities);

      assert.throws(() => {
        schema.getUpsertOrder();
      }, (err: Error) => {
        return err.message.includes('EntityA') || err.message.includes('EntityB');
      });
    });
  });
});
