import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Entity } from '../config/types';
import { DatabaseSchema } from '../context/schema';
import { buildBatchQuery, createEntityQueries, createEntityQuery } from './subgraphQueryBuilder';
import { ColumnType } from './types';

describe('Subgraph Query Builder', () => {
  let mockSchema: DatabaseSchema;

  beforeEach(() => {
    const testEntity: Entity = {
      name: 'BlockChangeLog',
      primaryKey: ['id'],
      subgraphProvider: 'mainProvider',
      columns: [
        { name: 'id', type: 'Bytes' },
        { name: 'blockNumber', type: 'BigInt' },
        { name: 'blockTimestamp', type: 'BigInt' },
        { name: 'updatedEntities', type: 'String' }
      ]
    };

    const proposalEntity: Entity = {
      name: 'Proposal',
      primaryKey: ['id'],
      subgraphProvider: 'mainProvider',
      columns: [
        { name: 'id', type: 'String' },
        { name: 'proposalId', type: 'String' },
        { name: 'state', type: 'String' },
        { name: 'votesFor', type: 'BigInt' },
        { name: 'votesAgainst', type: 'BigInt' }
      ]
    };

    const builderEntity: Entity = {
      name: 'Builder',
      primaryKey: ['id'],
      subgraphProvider: 'mainProvider',
      columns: [
        { name: 'id', type: 'Bytes' },
        { name: 'address', type: 'Bytes' },
        { name: 'name', type: 'String' },
        { name: 'activated', type: 'Boolean' }
      ]
    };

    mockSchema = {
      entities: new Map([
        ['BlockChangeLog', testEntity],
        ['Proposal', proposalEntity],
        ['Builder', builderEntity]
      ])
    };

  });

  describe('createEntityQuery', () => {
    it('should create a basic query without options', () => {
      const result = createEntityQuery(mockSchema, 'BlockChangeLog');

      assert.equal(result.entityName, 'BlockChangeLog');
      assert.ok(result.query.includes('blockChangeLogs'));
      assert.ok(result.query.includes('id'));
      assert.ok(result.query.includes('blockNumber'));
      assert.ok(result.query.includes('blockTimestamp'));
      assert.ok(result.query.includes('updatedEntities'));
    });

    it('should create a query with first option', () => {
      const result = createEntityQuery(mockSchema, 'BlockChangeLog', { first: 100 });

      assert.ok(result.query.includes('first: 100'));
    });

    it('should create a query with order options', () => {
      const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
        order: { by: 'blockNumber', direction: 'desc' }
      });

      assert.ok(result.query.includes('orderBy: blockNumber'));
      assert.ok(result.query.includes('orderDirection: desc'));
    });

    it('should create a query with filters', () => {
      const result = createEntityQuery(mockSchema, 'Proposal', {
        filters: { state: 'Active' }
      });

      assert.ok(result.query.includes('where:'));
      assert.ok(result.query.includes('state: "Active"'));
    });

    it('should create a query with alias', () => {
      const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
        alias: 'recentLogs'
      });

      assert.ok(result.query.includes('recentLogs: blockChangeLogs'));
    });

    it('should create a query with metadata flag', () => {
      const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
        withMetadata: true
      });

      assert.equal(result.withMetadata, true);
    });

    it('should throw error for non-existent entity', () => {
      assert.throws(
        () => createEntityQuery(mockSchema, 'NonExistentEntity'),
        /Entity 'NonExistentEntity' not found in schema/
      );
    });

    it('should handle multiple filters', () => {
      const result = createEntityQuery(mockSchema, 'Builder', {
        filters: {
          activated: 'true',
          name: 'TestBuilder'
        }
      });

      assert.ok(result.query.includes('where:'));
      assert.ok(result.query.includes('name: "TestBuilder"'));
    });

    it('should format bigint values in filters', () => {
      const result = createEntityQuery(mockSchema, 'Proposal', {
        filters: {
          votesFor: BigInt(1000)
        }
      });

      assert.ok(result.query.includes('votesFor: 1000'));
    });
  });

  describe('createEntityQueries', () => {
    it('should create queries for multiple entities', () => {
      const results = createEntityQueries(mockSchema, ['BlockChangeLog', 'Proposal']);

      assert.equal(results.length, 2);
      assert.equal(results[0].entityName, 'BlockChangeLog');
      assert.equal(results[1].entityName, 'Proposal');
    });

    it('should apply same options to all entities', () => {
      const results = createEntityQueries(mockSchema, ['BlockChangeLog', 'Proposal'], {
        first: 50,
        order: { by: 'id', direction: 'asc' }
      });

      results.forEach(result => {
        assert.ok(result.query.includes('first: 50'));
        assert.ok(result.query.includes('orderBy: id'));
        assert.ok(result.query.includes('orderDirection: asc'));
      });
    });

    it('should return empty array for empty entity names', () => {
      const results = createEntityQueries(mockSchema, []);
      assert.equal(results.length, 0);
    });
  });

  describe('buildBatchQuery', () => {
    it('should combine multiple queries into a batch', () => {
      const query1 = createEntityQuery(mockSchema, 'BlockChangeLog', { first: 10 });
      const query2 = createEntityQuery(mockSchema, 'Proposal', { first: 20 });

      const batchQuery = buildBatchQuery([
        { request: query1, index: 0 },
        { request: query2, index: 1 }
      ]);

      assert.ok(batchQuery.includes('query BatchQuery'));
      assert.ok(batchQuery.includes('blockChangeLogs_0:'));
      assert.ok(batchQuery.includes('proposals_1:'));
    });

    it('should include metadata when requested', () => {
      const query1 = createEntityQuery(mockSchema, 'BlockChangeLog', { withMetadata: true });

      const batchQuery = buildBatchQuery([
        { request: query1, index: 0 }
      ]);

      assert.ok(batchQuery.includes('_meta'));
      assert.ok(batchQuery.includes('block'));
      assert.ok(batchQuery.includes('number'));
      assert.ok(batchQuery.includes('hash'));
      assert.ok(batchQuery.includes('timestamp'));
      assert.ok(batchQuery.includes('deployment'));
      assert.ok(batchQuery.includes('hasIndexingErrors'));
    });

    it('should not include metadata when not requested', () => {
      const query1 = createEntityQuery(mockSchema, 'BlockChangeLog');

      const batchQuery = buildBatchQuery([
        { request: query1, index: 0 }
      ]);

      assert.ok(!batchQuery.includes('_meta'));
    });

    it('should throw error for empty requests array', () => {
      assert.throws(
        () => buildBatchQuery([]),
        /Cannot build batch query with empty requests array/
      );
    });

    it('should handle single query batch', () => {
      const query1 = createEntityQuery(mockSchema, 'BlockChangeLog');

      const batchQuery = buildBatchQuery([
        { request: query1, index: 0 }
      ]);

      assert.ok(batchQuery.includes('query BatchQuery'), 'Should include query BatchQuery');
      assert.ok(batchQuery.includes('blockChangeLogs_0:'), 'Should include blockChangeLogs_0:');
    });

    it('should properly index multiple queries', () => {
      const queries = ['BlockChangeLog', 'Proposal', 'Builder'].map(
        (entityName, index) => ({
          request: createEntityQuery(mockSchema, entityName),
          index
        })
      );

      const batchQuery = buildBatchQuery(queries);

      assert.ok(batchQuery.includes('blockChangeLogs_0:'), 'Should include blockChangeLogs_0:');
      assert.ok(batchQuery.includes('proposals_1:'), 'Should include proposals_1:');
      assert.ok(batchQuery.includes('builders_2:'), 'Should include builders_2:');
    });
  });

  describe('Query with nested objects', () => {
    it('should handle nested filter values', () => {
      const result = createEntityQuery(mockSchema, 'Proposal', {
        filters: {
          votesFor: { gt: BigInt(100) }
        }
      });

      assert.ok(result.query.includes('where:'));
      assert.ok(result.query.includes('votesFor: { gt: 100 }'));
    });
  });

  describe('Error handling', () => {
    describe('createEntityQuery errors', () => {
      it('should throw error for non-existent entity', () => {
        assert.throws(
          () => createEntityQuery(mockSchema, 'NonExistentEntity'),
          /Entity 'NonExistentEntity' not found in schema/
        );
      });

      it('should throw error for empty entity name', () => {
        assert.throws(
          () => createEntityQuery(mockSchema, ''),
          /Entity '' not found in schema/
        );
      });

      it('should throw error for null entity name', () => {
        assert.throws(
          () => createEntityQuery(mockSchema, null as any),
          /Entity 'null' not found in schema/
        );
      });

      it('should throw error for undefined entity name', () => {
        assert.throws(
          () => createEntityQuery(mockSchema, undefined as any),
          /Entity 'undefined' not found in schema/
        );
      });

      it('should handle entity with no columns gracefully', () => {
        const emptyEntity: Entity = {
          name: 'EmptyEntity',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: []
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([['EmptyEntity', emptyEntity]])
        };

        const result = createEntityQuery(testSchema, 'EmptyEntity');
        assert.ok(result.query.includes('emptyEntities'));
        // Should have no fields in the selection
        assert.ok(result.query.includes('{\n      \n    }'));
      });

      it('should handle invalid order direction gracefully', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
          order: { by: 'blockNumber', direction: 'invalid' as any }
        });

        // Should still include the invalid direction (GraphQL will handle the error)
        assert.ok(result.query.includes('orderDirection: invalid'));
      });

      it('should handle null filter values', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            state: null as any
          }
        });

        assert.ok(!result.query.includes('where:'));
        assert.ok(!result.query.includes('where: { state'));
      });

      it('should handle undefined filter values', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            state: undefined as any
          }
        });

        assert.ok(!result.query.includes('where:'));
        assert.ok(!result.query.includes('where: { state'));
      });

      it('should handle negative first value', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', { first: -10 });
        assert.ok(result.query.includes('first: -10'));
      });

      it('should handle zero first value', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', { first: 0 });
        assert.ok(result.query.includes('first: 0'));
      });

      it('should handle extremely large first value', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', { first: Number.MAX_SAFE_INTEGER });
        assert.ok(result.query.includes(`first: ${Number.MAX_SAFE_INTEGER}`));
      });

      it('should handle special characters in string filters', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            state: 'Active"with"quotes'
          }
        });

        assert.ok(result.query.includes('where:'));
        // The implementation doesn't escape quotes, it just wraps the value in quotes
        assert.ok(result.query.includes('state: "Active"with"quotes"'));
      });

      it('should handle deeply nested filter objects', () => {
        const nestedFilter = {
          gt: {
            value: BigInt(100),
            and: {
              lt: BigInt(1000)
            }
          }
        };
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            votesFor: nestedFilter as any
          }
        });

        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('votesFor:'));
      });

      it('should handle array filter values', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            state: ['Active', 'Pending'] as any
          }
        });

        // Arrays are converted to string
        assert.ok(result.query.includes('where:'), 'Query should include \'where:\'');
        assert.ok(result.query.includes('state: ["Active", "Pending"]'), 'Query should include \'state: Active,Pending\'');
      });

      it('should handle boolean filter values', () => {
        const result = createEntityQuery(mockSchema, 'Builder', {
          filters: {
            activated: true as any
          }
        });

        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('activated: true'));
      });

      it('should handle number filter values', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            votesFor: 12345
          }
        });

        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('votesFor: 12345'));
      });
    });

    describe('createEntityQueries errors', () => {
      it('should throw error if any entity is non-existent', () => {
        assert.throws(
          () => createEntityQueries(mockSchema, ['BlockChangeLog', 'NonExistentEntity', 'Proposal']),
          /Entity 'NonExistentEntity' not found in schema/
        );
      });

      it('should handle empty array gracefully', () => {
        const results = createEntityQueries(mockSchema, []);
        assert.equal(results.length, 0);
      });

      it('should throw error for null in entity names array', () => {
        assert.throws(
          () => createEntityQueries(mockSchema, ['BlockChangeLog', null as any]),
          /Entity 'null' not found in schema/
        );
      });

      it('should throw error for undefined in entity names array', () => {
        assert.throws(
          () => createEntityQueries(mockSchema, ['BlockChangeLog', undefined as any]),
          /Entity 'undefined' not found in schema/
        );
      });

      it('should handle duplicate entity names', () => {
        const results = createEntityQueries(mockSchema, ['BlockChangeLog', 'BlockChangeLog']);
        assert.equal(results.length, 2);
        assert.equal(results[0].entityName, 'BlockChangeLog');
        assert.equal(results[1].entityName, 'BlockChangeLog');
      });
    });

    describe('buildBatchQuery errors', () => {
      it('should throw error for empty requests array', () => {
        assert.throws(
          () => buildBatchQuery([]),
          /Cannot build batch query with empty requests array/
        );
      });

      it('should throw error for null requests', () => {
        assert.throws(
          () => buildBatchQuery(null as any),
          { name: 'TypeError' }
        );
      });

      it('should throw error for undefined requests', () => {
        assert.throws(
          () => buildBatchQuery(undefined as any),
          { name: 'TypeError' }
        );
      });

      it('should handle request with malformed query', () => {
        const malformedRequest = {
          entityName: 'Test',
          query: '',  // Empty query
          withMetadata: false
        };

        const batchQuery = buildBatchQuery([
          { request: malformedRequest, index: 0 }
        ]);

        // Should handle empty query gracefully
        assert.ok(batchQuery.includes('query BatchQuery'));
        assert.ok(batchQuery.includes('_0:'));
      });

      it('should handle request with missing index', () => {
        const query = createEntityQuery(mockSchema, 'BlockChangeLog');

        // undefined index will be concatenated as string "undefined"
        const result = buildBatchQuery([
          { request: query, index: undefined as any }
        ]);

        assert.ok(result.includes('_undefined:'));
      });

      it('should handle duplicate indices', () => {
        const query1 = createEntityQuery(mockSchema, 'BlockChangeLog');
        const query2 = createEntityQuery(mockSchema, 'Proposal');

        const batchQuery = buildBatchQuery([
          { request: query1, index: 0 },
          { request: query2, index: 0 }  // Duplicate index
        ]);

        // Should still work but with duplicate keys
        assert.ok(batchQuery.includes('blockChangeLogs_0:'));
        assert.ok(batchQuery.includes('proposals_0:'));
      });

      it('should handle negative indices', () => {
        const query = createEntityQuery(mockSchema, 'BlockChangeLog');

        const batchQuery = buildBatchQuery([
          { request: query, index: -1 }
        ]);

        assert.ok(batchQuery.includes('blockChangeLogs_-1:'));
      });

      it('should handle non-sequential indices', () => {
        const query1 = createEntityQuery(mockSchema, 'BlockChangeLog');
        const query2 = createEntityQuery(mockSchema, 'Proposal');

        const batchQuery = buildBatchQuery([
          { request: query1, index: 0 },
          { request: query2, index: 10 }
        ]);

        assert.ok(batchQuery.includes('blockChangeLogs_0:'));
        assert.ok(batchQuery.includes('proposals_10:'));
      });

      it('should handle very large index numbers', () => {
        const query = createEntityQuery(mockSchema, 'BlockChangeLog');

        const batchQuery = buildBatchQuery([
          { request: query, index: Number.MAX_SAFE_INTEGER }
        ]);

        assert.ok(batchQuery.includes(`blockChangeLogs_${Number.MAX_SAFE_INTEGER}:`));
      });
    });

    describe('Schema and entity edge cases', () => {
      it('should handle schema with no entities', () => {
        const emptySchema: DatabaseSchema = {
          entities: new Map()
        };

        assert.throws(
          () => createEntityQuery(emptySchema, 'AnyEntity'),
          /Entity 'AnyEntity' not found in schema/
        );
      });

      it('should handle entity with special characters in name', () => {
        const specialEntity: Entity = {
          name: 'Entity-With-Dashes',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([['Entity-With-Dashes', specialEntity]])
        };

        const result = createEntityQuery(testSchema, 'Entity-With-Dashes');
        assert.ok(result.query.includes('entity-With-Dashes')); // Check camelCase conversion
      });

      it('should handle entity ending with "y" for proper pluralization', () => {
        const entityEndingY: Entity = {
          name: 'Category',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([['Category', entityEndingY]])
        };

        const result = createEntityQuery(testSchema, 'Category');
        assert.ok(result.query.includes('categories')); // Should be 'categories' not 'categorys'
      });

      it('should handle entity with foreign key relationship', () => {
        const parentEntity: Entity = {
          name: 'Parent',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        };

        const childEntity: Entity = {
          name: 'Child',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'parent', type: 'Parent' as ColumnType }  // Foreign key
          ]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([
            ['Parent', parentEntity],
            ['Child', childEntity]
          ])
        };

        const result = createEntityQuery(testSchema, 'Child');
        assert.ok(result.query.includes('parent { id }')); // Should only select id from relationship
      });

      it('should handle circular foreign key relationships', () => {
        const nodeEntity: Entity = {
          name: 'Node',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [
            { name: 'id', type: 'Bytes' },
            { name: 'parentNode', type: 'Node' as ColumnType }  // Self-reference
          ]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([['Node', nodeEntity]])
        };

        const result = createEntityQuery(testSchema, 'Node');
        assert.ok(result.query.includes('parentNode { id }'));
      });

      it('should handle long entity names', () => {
        const longName = 'A'.repeat(100); // Reduced from 1000 to 100
        const longEntity: Entity = {
          name: longName,
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([[longName, longEntity]])
        };

        const result = createEntityQuery(testSchema, longName);
        assert.ok(result.entityName === longName);
      });

      it('should handle entity with empty name', () => {
        const emptyNameEntity: Entity = {
          name: '',
          primaryKey: ['id'],
          subgraphProvider: 'mainProvider',
          columns: [{ name: 'id', type: 'Bytes' }]
        };

        const testSchema: DatabaseSchema = {
          entities: new Map([['', emptyNameEntity]])
        };

        const result = createEntityQuery(testSchema, '');
        assert.ok(result.query.includes('s {')); // Empty name becomes 's' when pluralized
      });
    });

    describe('Filter value edge cases', () => {
      it('should handle filter with empty string value', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { state: '' }
        });

        assert.ok(result.query.includes('state: ""'));
      });

      it('should handle filter with object having toString method', () => {
        const customObject = {
          toString: () => 'customValue'
        };

        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { state: customObject as any }
        });

        // Objects get their entries mapped, function becomes "[Function]"
        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('state: {'));
        assert.ok(result.query.includes('toString: "[Function]"'));
      });

      it('should handle filter with Symbol value', () => {
        const symbolValue = Symbol('test');

        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { state: symbolValue as any }
        });

        // Symbol should be converted to string
        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('state: Symbol(test)'));
      });

      it('should handle filter with NaN value', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { votesFor: NaN as any }
        });

        assert.ok(result.query.includes('votesFor: NaN'));
      });

      it('should handle filter with Infinity value', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { votesFor: Infinity as any }
        });

        assert.ok(result.query.includes('votesFor: Infinity'));
      });

      it('should handle filter with negative Infinity value', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: { votesFor: -Infinity as any }
        });

        assert.ok(result.query.includes('votesFor: -Infinity'));
      });

      it('should handle empty filters object', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {}
        });

        // Empty filters should not add where clause
        assert.ok(!result.query.includes('where:'));
      });
      //
      it('should handle filters with function values', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          filters: {
            state: (() => 'Active') as any
          }
        });

        // Function should be converted to "[Function]"
        assert.ok(result.query.includes('where:'));
        assert.ok(result.query.includes('state: "[Function]"'));
      });
    });

    describe('Options validation', () => {
      it('should handle all options combined', () => {
        const result = createEntityQuery(mockSchema, 'Proposal', {
          first: 100,
          order: { by: 'id', direction: 'desc' },
          filters: { state: 'Active' },
          alias: 'activeProposals',
          withMetadata: true
        });

        assert.ok(result.query.includes('activeProposals: proposals'));
        assert.ok(result.query.includes('first: 100'));
        assert.ok(result.query.includes('orderBy: id'));
        assert.ok(result.query.includes('orderDirection: desc'));
        assert.ok(result.query.includes('state: "Active"'));
        assert.equal(result.withMetadata, true);
      });

      it('should handle options with extra unknown properties', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
          first: 10,
          unknownOption: 'value'
        } as any);

        // Should ignore unknown options
        assert.ok(result.query.includes('first: 10'));
        assert.ok(!result.query.includes('unknownOption'));
      });

      it('should handle null options', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', null as any);

        // Should treat as empty options
        assert.ok(result.query, 'Query should be defined');
        assert.ok(!result.query.includes('first:'), 'Query should not include \'first:\'');
        assert.ok(!result.query.includes('orderBy:'), 'Query should not include \'orderBy:\'');
      });

      it('should handle undefined options', () => {
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', undefined);

        // Should treat as empty options
        assert.ok(result.query);
        assert.ok(!result.query.includes('first:'));
        assert.ok(!result.query.includes('orderBy:'));
      });

      it('should handle order without direction', () => {
        const incompleteOrder = { by: 'blockNumber' } as { by: string; direction: 'asc' | 'desc' };
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
          order: incompleteOrder
        });

        assert.ok(result.query.includes('orderBy: blockNumber'));
        assert.ok(result.query.includes('orderDirection: undefined'));
      });

      it('should handle order without by field', () => {
        const incompleteOrder = { direction: 'asc' } as { by: string; direction: 'asc' | 'desc' };
        const result = createEntityQuery(mockSchema, 'BlockChangeLog', {
          order: incompleteOrder
        });

        assert.ok(result.query.includes('orderBy: undefined'));
        assert.ok(result.query.includes('orderDirection: asc'));
      });
    });
  });
});

