import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { withRetry } from './retry';

describe('Retry Utility', () => {
  beforeEach(() => {
    // Reset any timers or mocks if needed
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = mock.fn(async () => 'success');
      const result = await withRetry(fn, 3, 10);

      assert.equal(result, 'success');
      assert.equal(fn.mock.callCount(), 1);
    });

    it('should retry on failure and succeed', async () => {
      let attemptCount = 0;
      const fn = mock.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Temporary error');
        }
        return 'success';
      });

      const result = await withRetry(fn, 3, 10);

      assert.equal(result, 'success');
      assert.equal(fn.mock.callCount(), 2);
    });

    it('should retry multiple times before succeeding', async () => {
      let attemptCount = 0;
      const fn = mock.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Error on attempt ${attemptCount}`);
        }
        return 'success';
      });

      const result = await withRetry(fn, 3, 10);

      assert.equal(result, 'success');
      assert.equal(fn.mock.callCount(), 3);
    });

    it('should fail after max retries', async () => {
      const fn = mock.fn(async () => {
        throw new Error('Persistent error');
      });

      await assert.rejects(
        async () => await withRetry(fn, 2, 10),
        /Operation failed after 2 retries/
      );

      // Should attempt: initial + 2 retries = 3 total attempts
      assert.equal(fn.mock.callCount(), 3);
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      
      // Mock setTimeout to track delays
      global.setTimeout = mock.fn((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as any;

      let attemptCount = 0;
      const fn = mock.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Error');
        }
        return 'success';
      });

      await withRetry(fn, 3, 100);

      // First retry: 100 * 2^0 = 100ms
      // Second retry: 100 * 2^1 = 200ms
      assert.equal(delays.length, 2);
      assert.equal(delays[0], 100);
      assert.equal(delays[1], 200);

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    });

    it('should handle zero retries', async () => {
      const fn = mock.fn(async () => {
        throw new Error('Error');
      });

      await assert.rejects(
        async () => await withRetry(fn, 0, 10),
        /Operation failed after 0 retries/
      );

      // Should attempt: initial + 0 retries = 1 total attempt
      assert.equal(fn.mock.callCount(), 1);
    });

    it('should preserve error message in final error', async () => {
      const fn = mock.fn(async () => {
        throw new Error('Custom error message');
      });

      await assert.rejects(
        async () => await withRetry(fn, 1, 10),
        (error: Error) => {
          assert.match(error.message, /Operation failed after 1 retries/);
          assert.match(error.message, /Custom error message/);
          return true;
        }
      );
    });

    it('should work with different return types', async () => {
      const fnString = mock.fn(async () => 'string result');
      const fnNumber = mock.fn(async () => 42);
      const fnObject = mock.fn(async () => ({ key: 'value' }));

      const stringResult = await withRetry(fnString, 3, 10);
      const numberResult = await withRetry(fnNumber, 3, 10);
      const objectResult = await withRetry(fnObject, 3, 10);

      assert.equal(stringResult, 'string result');
      assert.equal(numberResult, 42);
      assert.deepEqual(objectResult, { key: 'value' });
    });

    it('should handle async functions that return void', async () => {
      const fn = mock.fn(async () => {
        // No return value
      });

      const result = await withRetry(fn, 3, 10);

      assert.equal(result, undefined);
      assert.equal(fn.mock.callCount(), 1);
    });
  });
});
