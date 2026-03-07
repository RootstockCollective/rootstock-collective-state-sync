/**
 * Unit Tests for GraphQL Query Batching
 *
 * Verifies that executeRequests() correctly batches multiple GraphQL queries
 * into a single HTTP request, reducing network overhead.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';
import {
  getRequestMetrics,
  getHttpMetrics,
  executeRequests,
  createTheGraphContext,
  GraphQlContext,
  GraphQLRequest
} from '../../context/subgraphProvider';

// ============================================================================
// Test Fixtures & Helpers
// ============================================================================

/** Default test context - reused across tests */
const TEST_CONTEXT_CONFIG = {
  url: 'https://gateway.thegraph.com/api',
  id: 'test-subgraph',
  maxRowsPerRequest: 1000,
  apiKey: 'test-key'
} as const;

/** Tracks actual fetch() calls during tests */
let fetchCalls: { url: string; options: RequestInit }[] = [];

/** Creates test context with default config */
function createTestContext(): GraphQlContext {
  return createTheGraphContext(TEST_CONTEXT_CONFIG);
}

/** Creates a standard GraphQL request with proper pluralization */
function createRequest(entityName: string, withMetadata = false): GraphQLRequest {
  // Match the pluralization logic used by the actual code
  const lowerName = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const pluralName = lowerName.endsWith('y') 
    ? lowerName.slice(0, -1) + 'ies' 
    : lowerName + 's';
  return {
    query: `${pluralName}(first: 1000) { id }`,
    entityName,
    withMetadata
  };
}

/** Sets up fetch mock that returns success response */
function mockFetchSuccess(responseData: Record<string, unknown>): void {
  global.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
    fetchCalls.push({
      url: typeof url === 'string' ? url : url.toString(),
      options: options || {}
    });
    return new Response(JSON.stringify({ data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
}

/** Sets up fetch mock that returns GraphQL errors */
function mockFetchGraphQLError(errorMessage: string): void {
  global.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
    fetchCalls.push({ url: String(url), options: options || {} });
    return new Response(JSON.stringify({
      data: {},
      errors: [{ message: errorMessage, locations: [{ line: 1, column: 1 }] }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
}

/** Sets up fetch mock that returns HTTP error */
function mockFetchHttpError(status: number): void {
  global.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
    fetchCalls.push({ url: String(url), options: options || {} });
    return new Response('Error', { status, statusText: 'Error' });
  }) as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe('Query Batching Tests', () => {
  beforeEach(() => {
    getRequestMetrics().reset();
    getHttpMetrics().reset();
    fetchCalls = [];

    // Default mock - returns standard response
    mockFetchSuccess({
      proposals_0: [{ id: '1' }],
      stakingHistories_1: [{ id: '2' }]
    });
  });

  describe('Basic Batching', () => {
    it('should combine multiple queries into one HTTP request', async () => {
      const context = createTestContext();
      const requests = [createRequest('Proposal'), createRequest('StakingHistory')];

      await executeRequests(context, requests);

      assert.equal(fetchCalls.length, 1, 'Should make exactly 1 HTTP request');

      // Verify batch query structure
      const body = JSON.parse(fetchCalls[0].options.body as string);
      assert.ok(body.query.includes('proposals_0:'), 'Should have proposals alias');
      assert.ok(body.query.includes('stakingHistories_1:'), 'Should have stakingHistories alias');
    });

    it('should return empty result on GraphQL errors', async () => {
      mockFetchGraphQLError('Query failed');
      const context = createTestContext();
      const requests = [createRequest('Proposal')];

      const result = await executeRequests(context, requests);

      assert.deepEqual(result, {});
      assert.equal(fetchCalls.length, 1, 'Request was still attempted');
    });

    it('should include _meta block when withMetadata is true', async () => {
      mockFetchSuccess({
        proposals_0: [{ id: '1' }],
        _meta: {
          block: { number: '1000000', hash: '0x123', timestamp: '1234567890' },
          deployment: 'test',
          hasIndexingErrors: false
        }
      });

      const context = createTestContext();
      const requests = [createRequest('Proposal', true)];

      const results = await executeRequests(context, requests);

      assert.ok((results as Record<string, unknown>)._meta, 'Should include _meta');
    });

    it('should return empty result on HTTP error', async () => {
      mockFetchHttpError(500);
      const context = createTestContext();
      const requests = [createRequest('Proposal')];

      const results = await executeRequests(context, requests);

      assert.deepEqual(results, {});
      assert.equal(fetchCalls.length, 1, 'Request was still attempted');
    });
  });

  describe('Batching Effectiveness', () => {
    it('should batch 5 queries into 1 HTTP request (80% reduction)', async () => {
      mockFetchSuccess({
        entity0s_0: [{ id: '1' }],
        entity1s_1: [{ id: '2' }],
        entity2s_2: [{ id: '3' }],
        entity3s_3: [{ id: '4' }],
        entity4s_4: [{ id: '5' }]
      });

      const context = createTestContext();
      const requests = Array.from({ length: 5 }, (_, i) => ({
        query: `entity${i}s(first: 1000) { id }`,
        entityName: `Entity${i}`,
        withMetadata: false
      }));

      await executeRequests(context, requests);

      assert.equal(fetchCalls.length, 1, '5 queries should make 1 HTTP request');

      // 5 queries, 1 request = 80% reduction
      const reduction = ((5 - 1) / 5 * 100);
      assert.equal(reduction, 80, 'Should achieve 80% reduction');
    });
  });
});
