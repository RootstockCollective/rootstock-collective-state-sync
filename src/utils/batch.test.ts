import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { chunk, processBatches } from './batch';

describe('Batch Utility', () => {
  describe('chunk', () => {
    it('should split array into chunks of specified size', () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const result = chunk(items, 3);

      assert.equal(result.length, 3);
      assert.deepEqual(result[0], [1, 2, 3]);
      assert.deepEqual(result[1], [4, 5, 6]);
      assert.deepEqual(result[2], [7]);
    });

    it('should handle exact division', () => {
      const items = [1, 2, 3, 4, 5, 6];
      const result = chunk(items, 3);

      assert.equal(result.length, 2);
      assert.deepEqual(result[0], [1, 2, 3]);
      assert.deepEqual(result[1], [4, 5, 6]);
    });

    it('should handle empty array', () => {
      const result = chunk([], 5);
      assert.equal(result.length, 0);
    });

    it('should handle single item', () => {
      const result = chunk([1], 5);
      assert.equal(result.length, 1);
      assert.deepEqual(result[0], [1]);
    });

    it('should handle chunk size larger than array', () => {
      const items = [1, 2, 3];
      const result = chunk(items, 10);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], [1, 2, 3]);
    });

    it('should handle chunk size of 1', () => {
      const items = [1, 2, 3];
      const result = chunk(items, 1);

      assert.equal(result.length, 3);
      assert.deepEqual(result[0], [1]);
      assert.deepEqual(result[1], [2]);
      assert.deepEqual(result[2], [3]);
    });

    it('should throw error for invalid batch size', () => {
      assert.throws(
        () => chunk([1, 2, 3], 0),
        /Batch size must be greater than 0/
      );

      assert.throws(
        () => chunk([1, 2, 3], -1),
        /Batch size must be greater than 0/
      );
    });

    it('should work with different types', () => {
      const strings = ['a', 'b', 'c', 'd'];
      const numbers = [1, 2, 3, 4];
      const objects = [{ id: 1 }, { id: 2 }, { id: 3 }];

      assert.deepEqual(chunk(strings, 2), [['a', 'b'], ['c', 'd']]);
      assert.deepEqual(chunk(numbers, 2), [[1, 2], [3, 4]]);
      assert.deepEqual(chunk(objects, 2), [[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
    });
  });

  describe('processBatches', () => {
    it('should process all batches sequentially', async () => {
      const items = [1, 2, 3, 4, 5];
      const processedBatches: number[][] = [];
      const processor = mock.fn(async (batch: number[]) => {
        processedBatches.push(batch);
      });

      await processBatches(items, 2, processor);

      assert.equal(processedBatches.length, 3);
      assert.deepEqual(processedBatches[0], [1, 2]);
      assert.deepEqual(processedBatches[1], [3, 4]);
      assert.deepEqual(processedBatches[2], [5]);
      assert.equal(processor.mock.callCount(), 3);
    });

    it('should handle empty array', async () => {
      const processor = mock.fn(async () => {
        // Empty processor for empty array test
      });
      await processBatches([], 5, processor);

      assert.equal(processor.mock.callCount(), 0);
    });

    it('should call processor with correct batch index', async () => {
      const items = [1, 2, 3, 4];
      const batchIndices: number[] = [];
      const processor = mock.fn(async (batch: number[], batchIndex: number) => {
        batchIndices.push(batchIndex);
      });

      await processBatches(items, 2, processor);

      assert.deepEqual(batchIndices, [0, 1]);
    });

    it('should call onProgress callback at specified intervals', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const progressCalls: [number, number, number, number][] = [];
      const onProgress = mock.fn((currentBatch, totalBatches, processedItems, totalItems) => {
        progressCalls.push([currentBatch, totalBatches, processedItems, totalItems]);
      });

      const processor = mock.fn(async () => {
        // Processor for progress callback test
      });

      await processBatches(items, 5, processor, {
        onProgress,
        logInterval: 2
      });

      // Should log at batches 2, 4 (every 2 batches)
      // With batch size 5: 25 items = 5 batches
      assert.equal(onProgress.mock.callCount(), 2);
      assert.deepEqual(progressCalls[0], [2, 5, 10, 25]);
      assert.deepEqual(progressCalls[1], [4, 5, 20, 25]);
    });

    it('should use default logInterval of 10', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      const progressCalls: [number, number, number, number][] = [];
      const onProgress = mock.fn((currentBatch, totalBatches, processedItems, totalItems) => {
        progressCalls.push([currentBatch, totalBatches, processedItems, totalItems]);
      });

      const processor = mock.fn(async () => {
        // Processor for default logInterval test
      });

      await processBatches(items, 10, processor, {
        onProgress
      });

      // Should log at batches 10, 20, etc. (every 10 batches)
      // With batch size 10: 100 items = 10 batches
      assert.equal(onProgress.mock.callCount(), 1);
      assert.deepEqual(progressCalls[0], [10, 10, 100, 100]);
    });

    it('should not call onProgress for single batch', async () => {
      const items = [1, 2, 3];
      const onProgress = mock.fn();
      const processor = mock.fn(async () => {
        // Processor for single batch test
      });

      await processBatches(items, 10, processor, {
        onProgress
      });

      assert.equal(onProgress.mock.callCount(), 0);
    });

    it('should handle processor errors', async () => {
      const items = [1, 2, 3];
      const processor = mock.fn(async () => {
        throw new Error('Processing error');
      });

      await assert.rejects(
        async () => await processBatches(items, 2, processor),
        /Processing error/
      );
    });

    it('should process batches in correct order', async () => {
      const items = [1, 2, 3, 4, 5];
      const processingOrder: number[] = [];
      const processor = mock.fn(async (batch: number[]) => {
        processingOrder.push(...batch);
      });

      await processBatches(items, 2, processor);

      assert.deepEqual(processingOrder, [1, 2, 3, 4, 5]);
    });

    it('should handle large batch sizes', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const processor = mock.fn(async () => {
        // Processor for large batch test
      });

      await processBatches(items, 1000, processor);

      assert.equal(processor.mock.callCount(), 1);
    });

    it('should handle small batch sizes', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      const processor = mock.fn(async () => {
        // Processor for small batch test
      });

      await processBatches(items, 1, processor);

      assert.equal(processor.mock.callCount(), 100);
    });
  });
});
