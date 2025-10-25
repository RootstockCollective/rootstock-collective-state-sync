import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { Entity } from '../config/types';
import { DatabaseContext } from '../context/db';
import { DatabaseSchema } from '../context/schema';
import { executeUpsert } from './dbUpsert';

describe('Database Upsert', () => {
  let mockDbContext: DatabaseContext;
  let mockSchema: DatabaseSchema;
  let mockDbFunction: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    // Mock the Knex database function with proper chaining
    const mockMerge = mock.fn(() => Promise.resolve());
    const mockOnConflict = mock.fn(() => ({ merge: mockMerge }));
    const mockInsert = mock.fn(() => ({ onConflict: mockOnConflict }));

    mockDbFunction = mock.fn(() => ({
      insert: mockInsert
    }));

    mockDbContext = {
      db: mockDbFunction as unknown as DatabaseContext['db'],
      batchSize: 1000,
      maxRetries: 3,
      initialRetryDelay: 100
    };

    const testEntity: Entity = {
      name: 'BlockChangeLog',
      primaryKey: ['id'],
      subgraphProvider: 'mainProvider',
      columns: [
        { name: 'id', type: 'Bytes' },
        { name: 'blockNumber', type: 'BigInt' },
        { name: 'blockTimestamp', type: 'BigInt' },
        { name: 'updatedEntities', type: ['String'] }
      ]
    };

    const proposalEntity: Entity = {
      name: 'Proposal',
      primaryKey: ['id'],
      subgraphProvider: 'mainProvider',
      columns: [
        { name: 'id', type: 'String' },
        { name: 'proposalId', type: 'String' },
        { name: 'builder', type: 'Builder' } // Foreign key reference
      ]
    };

    mockSchema = {
      entities: new Map([
        ['BlockChangeLog', testEntity],
        ['Proposal', proposalEntity]
      ])
    };
  });

  describe('executeUpsert', () => {
    it('should handle empty records array', async () => {
      await executeUpsert(mockDbContext, 'BlockChangeLog', [], mockSchema);

      // Database function should not be called for empty records
      assert.equal(mockDbContext.db.mock.calls.length, 0);
    });

    it('should throw error for non-existent entity', async () => {
      const records = [{ id: '0x123', blockNumber: BigInt(100) }];

      await assert.rejects(
        async () => executeUpsert(mockDbContext, 'NonExistentEntity', records, mockSchema),
        /Entity "NonExistentEntity" not found in schema/
      );
    });

    it('should process records successfully', async () => {
      const records = [
        {
          id: '0x123',
          blockNumber: BigInt(100),
          blockTimestamp: BigInt(1234567890),
          updatedEntities: ['Entity1', 'Entity2']
        }
      ];

      await executeUpsert(mockDbContext, 'BlockChangeLog', records, mockSchema);

      // Should call the database function
      assert.ok(mockDbContext.db.mock.calls.length > 0);
    });

    it('should filter reference fields to id only', async () => {
      const records = [
        {
          id: '0x123',
          proposalId: 'prop-1',
          builder: { id: '0xbuilder123', name: 'Builder Name', activated: true }
        }
      ];

      await executeUpsert(mockDbContext, 'Proposal', records, mockSchema);

      // The insert should be called with the builder field replaced by just the id
      assert.ok(mockDbContext.db.mock.calls.length > 0);
    });

    it('should batch large record sets', async () => {
      const records = Array.from({ length: 2500 }, (_, i) => ({
        id: `0x${i}`,
        blockNumber: BigInt(i),
        blockTimestamp: BigInt(1234567890 + i),
        updatedEntities: []
      }));

      await executeUpsert(mockDbContext, 'BlockChangeLog', records, mockSchema);

      // Should process in batches of 1000 (batchSize)
      // 2500 records = 3 batches
      assert.equal(mockDbContext.db.mock.calls.length, 3);
    });

    it('should respect custom batch size', async () => {
      const customBatchContext = { ...mockDbContext, batchSize: 500 };
      const records = Array.from({ length: 1200 }, (_, i) => ({
        id: `0x${i}`,
        blockNumber: BigInt(i),
        blockTimestamp: BigInt(1234567890 + i),
        updatedEntities: []
      }));

      await executeUpsert(customBatchContext, 'BlockChangeLog', records, mockSchema);

      // 1200 records with batch size 500 = 3 batches
      assert.equal(customBatchContext.db.mock.calls.length, 3);
    });

    it('should handle records with missing optional fields', async () => {
      const records = [
        {
          id: '0x123',
          blockNumber: BigInt(100),
          // blockTimestamp missing
          updatedEntities: []
        }
      ];

      await executeUpsert(mockDbContext, 'BlockChangeLog', records, mockSchema);

      assert.ok(mockDbContext.db.mock.calls.length > 0);
    });

    it('should handle null reference fields', async () => {
      const records = [
        {
          id: '0x123',
          proposalId: 'prop-1',
          builder: null // null foreign key
        }
      ];

      await executeUpsert(mockDbContext, 'Proposal', records, mockSchema);

      assert.ok(mockDbContext.db.mock.calls.length > 0);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      let attemptCount = 0;

      const mockFailThenSucceed = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return {
            insert: mock.fn(() => {
              throw new Error('Database error');
            })
          };
        }

        const mockMerge = mock.fn(() => Promise.resolve());
        const mockOnConflict = mock.fn(() => ({ merge: mockMerge }));
        const mockInsert = mock.fn(() => ({ onConflict: mockOnConflict }));

        return { insert: mockInsert };
      });

      const retryContext = {
        ...mockDbContext,
        db: mockFailThenSucceed as unknown as DatabaseContext['db'],
        maxRetries: 3,
        initialRetryDelay: 10
      };

      const records = [
        {
          id: '0x123',
          blockNumber: BigInt(100),
          blockTimestamp: BigInt(1234567890),
          updatedEntities: []
        }
      ];

      // This should succeed after retry
      await executeUpsert(retryContext, 'BlockChangeLog', records, mockSchema);

      assert.ok(attemptCount >= 2);
    });

    it('should fail after max retries', async () => {
      const mockAlwaysFail = mock.fn(() => {
        throw new Error('Persistent database error');
      });

      const failContext = {
        ...mockDbContext,
        db: mockAlwaysFail as unknown as DatabaseContext['db'],
        maxRetries: 2,
        initialRetryDelay: 10
      };

      const records = [
        {
          id: '0x123',
          blockNumber: BigInt(100),
          blockTimestamp: BigInt(1234567890),
          updatedEntities: []
        }
      ];

      await assert.rejects(
        async () => executeUpsert(failContext, 'BlockChangeLog', records, mockSchema),
        /Operation failed after 2 retries/
      );
    });
  });
});

