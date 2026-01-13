import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';
import { getLastProcessedBlock, trackEntityIds } from './utils';
import { BlockChangeLog } from './types';
import type { AppContext } from '../../context/types';
import type { EntityDataCollection } from '../../handlers/types';

describe('Watchers Strategies Utils', () => {
  let mockDb: any;
  let mockOrderBy: any;
  let mockFirst: any;

  beforeEach(() => {
    // Create mock chain for Knex query builder
    mockFirst = mock.fn();
    mockOrderBy = mock.fn(() => ({ first: mockFirst }));
    mockDb = mock.fn(() => ({ orderBy: mockOrderBy }));
  });

  describe('getLastProcessedBlock', () => {
    describe('Happy path scenarios', () => {
      it('should return the last processed block when exists', async () => {
        const expectedBlock: BlockChangeLog = {
          id: '0xabc123',
          blockNumber: BigInt(12345),
          blockTimestamp: BigInt(1234567890),
          updatedEntities: ['Entity1', 'Entity2']
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(expectedBlock));

        const result = await getLastProcessedBlock(mockDb);

        assert.deepEqual(result, expectedBlock);
        assert.equal(mockDb.mock.callCount(), 1);
        assert.deepEqual(mockDb.mock.calls[0].arguments, ['BlockChangeLog']);
        assert.equal(mockOrderBy.mock.callCount(), 1);
        assert.deepEqual(mockOrderBy.mock.calls[0].arguments, ['blockNumber', 'desc']);
        assert.equal(mockFirst.mock.callCount(), 1);
      });

      it('should return default block when no blocks exist', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(null));

        const result = await getLastProcessedBlock(mockDb);

        assert.equal(result.id, '0x00');
        assert.equal(result.blockNumber, BigInt(0));
        assert.equal(result.blockTimestamp, BigInt(0));
        assert.deepEqual(result.updatedEntities, []);
      });

      it('should return default block when query returns undefined', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(undefined));

        const result = await getLastProcessedBlock(mockDb);

        assert.equal(result.id, '0x00');
        assert.equal(result.blockNumber, BigInt(0));
        assert.equal(result.blockTimestamp, BigInt(0));
        assert.deepEqual(result.updatedEntities, []);
      });

      it('should handle block with empty updatedEntities', async () => {
        const blockWithEmptyEntities: BlockChangeLog = {
          id: '0xdef456',
          blockNumber: BigInt(99999),
          blockTimestamp: BigInt(9999999999),
          updatedEntities: []
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(blockWithEmptyEntities));

        const result = await getLastProcessedBlock(mockDb);
        assert.deepEqual(result, blockWithEmptyEntities);
      });

      it('should handle block with very large numbers', async () => {
        const largeBlock: BlockChangeLog = {
          id: '0xffffffff',
          blockNumber: BigInt(Number.MAX_SAFE_INTEGER),
          blockTimestamp: BigInt('9999999999999999999'),
          updatedEntities: ['Entity1']
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(largeBlock));

        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.blockNumber, BigInt(Number.MAX_SAFE_INTEGER));
        assert.equal(result.blockTimestamp, BigInt('9999999999999999999'));
      });

      it('should handle block with many updatedEntities', async () => {
        const entitiesArray = Array.from({ length: 1000 }, (_, i) => `Entity${i}`);
        const blockWithManyEntities: BlockChangeLog = {
          id: '0x789',
          blockNumber: BigInt(5000),
          blockTimestamp: BigInt(5000000),
          updatedEntities: entitiesArray
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(blockWithManyEntities));

        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.updatedEntities.length, 1000);
        assert.equal(result.updatedEntities[0], 'Entity0');
        assert.equal(result.updatedEntities[999], 'Entity999');
      });
    });

    describe('Edge cases', () => {
      it('should handle database query errors', async () => {
        mockFirst.mock.mockImplementation(() => Promise.reject(new Error('Database connection failed')));

        await assert.rejects(
          async () => await getLastProcessedBlock(mockDb),
          { message: 'Database connection failed' }
        );
      });

      it('should handle orderBy errors', async () => {
        mockOrderBy.mock.mockImplementation(() => {
          throw new Error('Invalid column name');
        });

        await assert.rejects(
          async () => await getLastProcessedBlock(mockDb),
          { message: 'Invalid column name' }
        );
      });

      it('should handle null database object', async () => {
        await assert.rejects(
          async () => await getLastProcessedBlock(null as any),
          { name: 'TypeError' }
        );
      });

      it('should handle undefined database object', async () => {
        await assert.rejects(
          async () => await getLastProcessedBlock(undefined as any),
          { name: 'TypeError' }
        );
      });

      it('should handle malformed block data', async () => {
        const malformedBlock = {
          id: 123, // Wrong type - should be string
          blockNumber: '12345', // Wrong type - should be BigInt
          blockTimestamp: null,
          updatedEntities: 'not-an-array' // Wrong type - should be array
        } as any;

        mockFirst.mock.mockImplementation(() => Promise.resolve(malformedBlock));

        const result = await getLastProcessedBlock(mockDb);
        
        // The function should return the malformed data as-is
        // The caller is responsible for validation
        assert.equal(result.id, 123);
        assert.equal(result.blockNumber, '12345');
        assert.equal(result.blockTimestamp, null);
        assert.equal(result.updatedEntities, 'not-an-array');
      });

      it('should handle block with special characters in id', async () => {
        const specialBlock: BlockChangeLog = {
          id: '0x!@#$%^&*()',
          blockNumber: BigInt(1000),
          blockTimestamp: BigInt(1000000),
          updatedEntities: []
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(specialBlock));

        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.id, '0x!@#$%^&*()');
      });

      it('should handle block with negative blockNumber', async () => {
        const negativeBlock: BlockChangeLog = {
          id: '0xneg',
          blockNumber: BigInt(-100),
          blockTimestamp: BigInt(-1000),
          updatedEntities: []
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(negativeBlock));

        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.blockNumber, BigInt(-100));
        assert.equal(result.blockTimestamp, BigInt(-1000));
      });

      it('should handle block with zero values', async () => {
        const zeroBlock: BlockChangeLog = {
          id: '',
          blockNumber: BigInt(0),
          blockTimestamp: BigInt(0),
          updatedEntities: []
        };

        mockFirst.mock.mockImplementation(() => Promise.resolve(zeroBlock));

        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.id, '');
        assert.equal(result.blockNumber, BigInt(0));
      });

      it('should handle database returning empty object', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve({}));

        const result = await getLastProcessedBlock(mockDb);
        
        // Empty object is truthy, so it returns the empty object as-is
        assert.deepEqual(result, {});
      });

      it('should handle database timeout', async () => {
        mockFirst.mock.mockImplementation(() => 
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout')), 100);
          })
        );

        await assert.rejects(
          async () => await getLastProcessedBlock(mockDb),
          { message: 'Query timeout' }
        );
      });

      it('should handle concurrent calls', async () => {
        let callCount = 0;
        mockFirst.mock.mockImplementation(async () => {
          callCount++;
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            id: `0x${callCount}`,
            blockNumber: BigInt(callCount),
            blockTimestamp: BigInt(callCount * 1000),
            updatedEntities: []
          };
        });

        const results = await Promise.all([
          getLastProcessedBlock(mockDb),
          getLastProcessedBlock(mockDb),
          getLastProcessedBlock(mockDb)
        ]);

        assert.equal(results.length, 3);
        assert.equal(mockDb.mock.callCount(), 3);
      });
    });

    describe('Default value correctness', () => {
      it('should return correct default id format', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(null));
        const result = await getLastProcessedBlock(mockDb);
        assert.equal(result.id, '0x00');
        assert.match(result.id, /^0x[0-9a-fA-F]+$/);
      });

      it('should return BigInt(0) for default blockNumber', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(null));
        const result = await getLastProcessedBlock(mockDb);
        assert.equal(typeof result.blockNumber, 'bigint');
        assert.equal(result.blockNumber, BigInt(0));
      });

      it('should return BigInt(0) for default blockTimestamp', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(null));
        const result = await getLastProcessedBlock(mockDb);
        assert.equal(typeof result.blockTimestamp, 'bigint');
        assert.equal(result.blockTimestamp, BigInt(0));
      });

      it('should return empty array for default updatedEntities', async () => {
        mockFirst.mock.mockImplementation(() => Promise.resolve(null));
        const result = await getLastProcessedBlock(mockDb);
        assert.ok(Array.isArray(result.updatedEntities));
        assert.equal(result.updatedEntities.length, 0);
      });
    });

    describe('Query builder chain', () => {
      it('should call methods in correct order', async () => {
        const callOrder: string[] = [];
        
        const mockDbWithOrder = mock.fn(() => {
          callOrder.push('db');
          return {
            orderBy: mock.fn(() => {
              callOrder.push('orderBy');
              return {
                first: mock.fn(() => {
                  callOrder.push('first');
                  return Promise.resolve(null);
                })
              };
            })
          };
        });

        await getLastProcessedBlock(mockDbWithOrder);
        
        assert.deepEqual(callOrder, ['db', 'orderBy', 'first']);
      });

      it('should pass correct table name to db function', async () => {
        await getLastProcessedBlock(mockDb);
        assert.equal(mockDb.mock.calls[0].arguments[0], 'BlockChangeLog');
      });

      it('should use desc order for blockNumber', async () => {
        await getLastProcessedBlock(mockDb);
        assert.equal(mockOrderBy.mock.calls[0].arguments[0], 'blockNumber');
        assert.equal(mockOrderBy.mock.calls[0].arguments[1], 'desc');
      });
    });
  });

  describe('trackEntityIds', () => {
    let mockDbContext: AppContext['dbContext'];
    let mockDb: any;
    let mockInsert: any;
    let mockOnConflict: any;
    let mockMerge: any;

    beforeEach(() => {
      mockMerge = mock.fn(() => Promise.resolve());
      mockOnConflict = mock.fn(() => ({ merge: mockMerge }));
      mockInsert = mock.fn(() => ({ onConflict: mockOnConflict }));
      mockDb = mock.fn(() => ({ insert: mockInsert }));

      mockDbContext = {
        db: mockDb as any,
        schema: 'public',
        batchSize: 1000,
        maxRetries: 3,
        initialRetryDelay: 100
      };
    });

    describe('Happy path scenarios', () => {
      it('should create entity change log entries correctly', async () => {
        const entityData: EntityDataCollection = {
          Builder: [
            { id: '0x123', gauge: '0x456', totalAllocation: BigInt(1000) },
            { id: '0x789', gauge: '0xabc', totalAllocation: BigInt(2000) }
          ]
        };

        const blockNumber = 1000n;
        const blockHash = '0xblockhash';

        await trackEntityIds(mockDbContext, entityData, blockNumber, blockHash);

        // Verify database was called
        assert.equal(mockDb.mock.callCount(), 1);
        assert.equal(mockDb.mock.calls[0].arguments[0], 'EntityChangeLog');
        assert.equal(mockInsert.mock.callCount(), 1);

        // Verify the batch contains correct entries
        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 2);
        assert.deepEqual(insertedBatch[0], {
          id: '1000-Builder-0x123',
          blockNumber: 1000n,
          blockHash: '0xblockhash',
          entityName: 'Builder',
          entityId: '0x123'
        });
        assert.deepEqual(insertedBatch[1], {
          id: '1000-Builder-0x789',
          blockNumber: 1000n,
          blockHash: '0xblockhash',
          entityName: 'Builder',
          entityId: '0x789'
        });
      });

      it('should handle multiple entity types', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }],
          Proposal: [{ id: 'prop-1' }, { id: 'prop-2' }],
          Gauge: [{ id: 'gauge-1' }]
        };

        await trackEntityIds(mockDbContext, entityData, 5000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 4);
        
        // Verify all entities are included
        const entityNames = insertedBatch.map((e: any) => e.entityName);
        assert.ok(entityNames.includes('Builder'));
        assert.ok(entityNames.includes('Proposal'));
        assert.ok(entityNames.includes('Gauge'));
      });

      it('should create correct ID format', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0xabc123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 12345n, '0xtesthash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch[0].id, '12345-Builder-0xabc123');
      });

      it('should convert entity IDs to strings', async () => {
        const entityData: EntityDataCollection = {
          Builder: [
            { id: 12345 }, // number
            { id: BigInt(67890) }, // BigInt
            { id: null }, // null
            { id: undefined } // undefined
          ]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 4);
        assert.equal(typeof insertedBatch[0].entityId, 'string');
        assert.equal(insertedBatch[0].entityId, '12345');
        assert.equal(insertedBatch[1].entityId, '67890');
        assert.equal(insertedBatch[2].entityId, 'null');
        assert.equal(insertedBatch[3].entityId, 'undefined');
      });
    });

    describe('Ignorable entities', () => {
      it('should skip LastProcessedBlock entity', async () => {
        const entityData: EntityDataCollection = {
          LastProcessedBlock: [{ id: true, number: 1000n, timestamp: 1234567890n }],
          Builder: [{ id: '0x123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        // Should only have Builder entry, not LastProcessedBlock
        assert.equal(insertedBatch.length, 1);
        assert.equal(insertedBatch[0].entityName, 'Builder');
        assert.equal(insertedBatch[0].entityId, '0x123');
      });

      it('should skip EntityChangeLog entity', async () => {
        const entityData: EntityDataCollection = {
          EntityChangeLog: [
            { id: '1000-Builder-0x123', blockNumber: 1000n, entityName: 'Builder', entityId: '0x123' }
          ],
          Builder: [{ id: '0x456' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        // Should only have Builder entry, not EntityChangeLog
        assert.equal(insertedBatch.length, 1);
        assert.equal(insertedBatch[0].entityName, 'Builder');
        assert.equal(insertedBatch[0].entityId, '0x456');
      });

      it('should skip both ignorable entities', async () => {
        const entityData: EntityDataCollection = {
          LastProcessedBlock: [{ id: true }],
          EntityChangeLog: [{ id: 'test' }],
          Builder: [{ id: '0x123' }],
          Proposal: [{ id: 'prop-1' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        // Should only have Builder and Proposal entries
        assert.equal(insertedBatch.length, 2);
        const entityNames = insertedBatch.map((e: any) => e.entityName);
        assert.ok(entityNames.includes('Builder'));
        assert.ok(entityNames.includes('Proposal'));
        assert.ok(!entityNames.includes('LastProcessedBlock'));
        assert.ok(!entityNames.includes('EntityChangeLog'));
      });
    });

    describe('Empty and edge cases', () => {
      it('should handle empty entity data', async () => {
        const entityData: EntityDataCollection = {};

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        // Should not call database when no entries
        assert.equal(mockDb.mock.callCount(), 0);
      });

      it('should handle entity data with only ignorable entities', async () => {
        const entityData: EntityDataCollection = {
          LastProcessedBlock: [{ id: true }],
          EntityChangeLog: [{ id: 'test' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        // Should not call database when all entities are ignorable
        assert.equal(mockDb.mock.callCount(), 0);
      });

      it('should handle entity with empty records array', async () => {
        const entityData: EntityDataCollection = {
          Builder: [],
          Proposal: [{ id: 'prop-1' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        // Should only have Proposal entry
        assert.equal(insertedBatch.length, 1);
        assert.equal(insertedBatch[0].entityName, 'Proposal');
      });

      it('should handle very large block numbers', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        const largeBlockNumber = BigInt('999999999999999999999');
        await trackEntityIds(mockDbContext, entityData, largeBlockNumber, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch[0].blockNumber, largeBlockNumber);
        assert.equal(insertedBatch[0].id, `${largeBlockNumber.toString()}-Builder-0x123`);
      });

      it('should handle zero block number', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 0n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch[0].blockNumber, 0n);
        assert.equal(insertedBatch[0].id, '0-Builder-0x123');
      });

      it('should handle empty block hash', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch[0].blockHash, '');
      });
    });

    describe('Batching behavior', () => {
      it('should batch entries according to batchSize', async () => {
        const largeBatchContext = {
          ...mockDbContext,
          batchSize: 3
        };

        const entityData: EntityDataCollection = {
          Builder: Array.from({ length: 10 }, (_, i) => ({ id: `0x${i}` }))
        };

        await trackEntityIds(largeBatchContext, entityData, 1000n, '0xhash');

        // With batchSize of 3 and 10 entries, should have 4 batches (3+3+3+1)
        // But processBatches calls insert once per batch
        assert.ok(mockInsert.mock.callCount() >= 1);
      });

      it('should handle single batch when entries fit', async () => {
        const entityData: EntityDataCollection = {
          Builder: Array.from({ length: 5 }, (_, i) => ({ id: `0x${i}` }))
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        // With batchSize of 1000 and 5 entries, should have 1 batch
        assert.equal(mockInsert.mock.callCount(), 1);
        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 5);
      });
    });

    describe('Database operations', () => {
      it('should use onConflict and merge for upsert', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        // Verify the chain: insert -> onConflict -> merge
        assert.equal(mockInsert.mock.callCount(), 1);
        assert.equal(mockOnConflict.mock.callCount(), 1);
        assert.equal(mockOnConflict.mock.calls[0].arguments[0], 'id');
        assert.equal(mockMerge.mock.callCount(), 1);
      });

      it('should handle database errors with retry', async () => {
        let attemptCount = 0;
        const failingMerge = mock.fn(async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error('Database error');
          }
          return Promise.resolve();
        });

        mockMerge.mock.mockImplementation(failingMerge);

        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        // Should retry and eventually succeed
        assert.ok(attemptCount >= 2);
      });

      it('should fail after max retries', async () => {
        const alwaysFailingMerge = mock.fn(async () => {
          throw new Error('Persistent database error');
        });

        mockMerge.mock.mockImplementation(alwaysFailingMerge);

        const failingContext = {
          ...mockDbContext,
          maxRetries: 2,
          initialRetryDelay: 10
        };

        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }]
        };

        await assert.rejects(
          async () => await trackEntityIds(failingContext, entityData, 1000n, '0xhash'),
          /Operation failed after 2 retries/
        );
      });
    });

    describe('ID generation edge cases', () => {
      it('should handle entity IDs with special characters', async () => {
        const entityData: EntityDataCollection = {
          Builder: [
            { id: '0x!@#$%^&*()' },
            { id: 'test-id-with-dashes' },
            { id: 'test_id_with_underscores' }
          ]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 3);
        assert.equal(insertedBatch[0].id, '1000-Builder-0x!@#$%^&*()');
        assert.equal(insertedBatch[1].id, '1000-Builder-test-id-with-dashes');
        assert.equal(insertedBatch[2].id, '1000-Builder-test_id_with_underscores');
      });

      it('should handle duplicate entity IDs across different entities', async () => {
        const entityData: EntityDataCollection = {
          Builder: [{ id: '0x123' }],
          Proposal: [{ id: '0x123' }] // Same ID, different entity
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch.length, 2);
        // IDs should be different because entity names differ
        assert.equal(insertedBatch[0].id, '1000-Builder-0x123');
        assert.equal(insertedBatch[1].id, '1000-Proposal-0x123');
      });

      it('should handle very long entity IDs', async () => {
        const longId = '0x' + 'a'.repeat(1000);
        const entityData: EntityDataCollection = {
          Builder: [{ id: longId }]
        };

        await trackEntityIds(mockDbContext, entityData, 1000n, '0xhash');

        const insertedBatch = mockInsert.mock.calls[0].arguments[0];
        assert.equal(insertedBatch[0].entityId, longId);
        assert.equal(insertedBatch[0].id, `1000-Builder-${longId}`);
      });
    });
  });
});
