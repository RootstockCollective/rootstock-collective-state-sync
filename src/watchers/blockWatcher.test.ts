import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { watchBlocks } from './blockWatcher';

/**
 * Block Watcher Tests
 * 
 * These are unit tests for the blockWatcher module.
 * 
 * NOTE: Full integration tests are skipped by default because they require:
 * - A running PostgreSQL database
 * - GraphQL endpoints (or mocked servers)
 * - Blockchain RPC endpoint (or mocked)
 * 
 * To run integration tests:
 * 1. Set NODE_ENV=test to use config/test.yml
 * 2. Ensure test infrastructure is running
 * 3. Run with RUN_INTEGRATION_TESTS=true npm test
 */

describe('Block Watcher Unit Tests', () => {
  describe('Module exports', () => {
    it('should export watchBlocks function', () => {
      assert.equal(typeof watchBlocks, 'function');
    });

    it('should have correct function signature', () => {
      assert.equal(watchBlocks.length, 1); // Takes 1 parameter (context)
    });
    
    it('should be an async function', () => {
      // watchBlocks returns a Promise
      assert.equal(watchBlocks.constructor.name, 'AsyncFunction');
    });
  });
});
