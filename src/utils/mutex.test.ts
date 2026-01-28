import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Mutex } from './mutex';

describe('Mutex', () => {
  describe('isLocked', () => {
    it('should return false when mutex is not locked', () => {
      const mutex = new Mutex();
      assert.equal(mutex.isLocked(), false);
    });

    it('should return true when mutex is locked', () => {
      const mutex = new Mutex();
      const release = mutex.acquire();
      assert.equal(mutex.isLocked(), true);
      release();
    });

    it('should return false after lock is released', () => {
      const mutex = new Mutex();
      const release = mutex.acquire();
      assert.equal(mutex.isLocked(), true);
      release();
      assert.equal(mutex.isLocked(), false);
    });
  });

  describe('acquire', () => {
    it('should acquire lock and return release function', () => {
      const mutex = new Mutex();
      assert.equal(mutex.isLocked(), false);
      
      const release = mutex.acquire();
      assert.equal(typeof release, 'function');
      assert.equal(mutex.isLocked(), true);
      
      release();
      assert.equal(mutex.isLocked(), false);
    });

    it('should throw error when trying to acquire already locked mutex', () => {
      const mutex = new Mutex();
      const release1 = mutex.acquire();
      
      assert.throws(() => {
        mutex.acquire();
      }, {
        name: 'Error',
        message: 'Mutex is already locked'
      });
      
      release1();
    });

    it('should allow re-acquiring lock after release', () => {
      const mutex = new Mutex();
      const release1 = mutex.acquire();
      assert.equal(mutex.isLocked(), true);
      
      release1();
      assert.equal(mutex.isLocked(), false);
      
      const release2 = mutex.acquire();
      assert.equal(mutex.isLocked(), true);
      release2();
    });

    it('should allow multiple acquire-release cycles', () => {
      const mutex = new Mutex();
      
      for (let i = 0; i < 5; i++) {
        const release = mutex.acquire();
        assert.equal(mutex.isLocked(), true);
        release();
        assert.equal(mutex.isLocked(), false);
      }
    });
  });

  describe('wait', () => {
    it('should resolve immediately when mutex is not locked', async () => {
      const mutex = new Mutex();
      await assert.doesNotReject(async () => {
        await mutex.wait();
      });
    });

    it('should wait for lock to be released', async () => {
      const mutex = new Mutex();
      const release = mutex.acquire();
      
      let waitResolved = false;
      const waitPromise = mutex.wait().then(() => {
        waitResolved = true;
      });
      
      // Wait a bit to ensure wait() doesn't resolve immediately
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(waitResolved, false, 'wait() should not resolve while lock is held');
      
      // Release lock
      release();
      
      // Wait for wait() to resolve
      await waitPromise;
      assert.equal(waitResolved, true, 'wait() should resolve after lock is released');
    });

    it('should resolve immediately after lock is released', async () => {
      const mutex = new Mutex();
      const release = mutex.acquire();
      release();
      
      // After release, wait() should resolve immediately
      await assert.doesNotReject(async () => {
        await mutex.wait();
      });
    });

    it('should handle multiple waiters', async () => {
      const mutex = new Mutex();
      const release = mutex.acquire();
      
      const waitPromises = [
        mutex.wait(),
        mutex.wait(),
        mutex.wait()
      ];
      
      // All should be waiting
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Release lock - all waiters should resolve
      release();
      
      await Promise.all(waitPromises);
      // All promises resolved successfully
    });
  });

  describe('integration scenarios', () => {
    it('should prevent concurrent operations', async () => {
      const mutex = new Mutex();
      let concurrentOperations = 0;
      let maxConcurrent = 0;
      const executionOrder: number[] = [];
      let operationId = 0;
      
      const operation = async (id: number) => {
        // Wait for lock to be available, then acquire
        while (true) {
          await mutex.wait();
          try {
            const release = mutex.acquire();
            try {
              concurrentOperations++;
              if (concurrentOperations > maxConcurrent) {
                maxConcurrent = concurrentOperations;
              }
              
              executionOrder.push(id);
              
              // Simulate some work - ensure we hold the lock long enough
              await new Promise(resolve => setTimeout(resolve, 20));
              
              concurrentOperations--;
              break; // Successfully completed
            } finally {
              release();
            }
          } catch (error: any) {
            // Lock was acquired by another operation, wait and retry
            if (error.message === 'Mutex is already locked') {
              await new Promise(resolve => setTimeout(resolve, 5));
              continue;
            }
            throw error;
          }
        }
      };
      
      // Start multiple operations concurrently
      // They will wait for each other sequentially
      const operations = [
        operation(++operationId),
        operation(++operationId),
        operation(++operationId),
        operation(++operationId),
        operation(++operationId)
      ];
      
      await Promise.all(operations);
      
      // Only one operation should run at a time
      assert.equal(maxConcurrent, 1, 'Only one operation should run at a time');
      assert.equal(concurrentOperations, 0, 'All operations should complete');
      assert.equal(executionOrder.length, 5, 'All operations should complete');
    });

    it('should handle rapid acquire-release cycles', () => {
      const mutex = new Mutex();
      
      for (let i = 0; i < 100; i++) {
        const release = mutex.acquire();
        assert.equal(mutex.isLocked(), true);
        release();
        assert.equal(mutex.isLocked(), false);
      }
    });
  });
});
