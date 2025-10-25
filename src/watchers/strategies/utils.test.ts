import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';
import { getLastProcessedBlock } from './utils';
import { BlockChangeLog } from './types';

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
});
