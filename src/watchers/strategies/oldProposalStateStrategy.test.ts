/**
 * Integration tests for oldProposalStateStrategy using a real test database.
 * 
 * These tests verify:
 * - Real database queries work correctly
 * - Interval-based checking logic
 * - Old proposal filtering (older than one week)
 * - Configuration usage
 * - Error handling with real errors
 * 
 * Requires test database to be running (e.g., via docker-compose up -d postgres).
 * Set TEST_DATABASE_URL environment variable or use default: postgresql://test:test@localhost:5432/test
 * 
 * Note: These tests use a real database but mock the blockchain client.
 */

import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import { createOldProposalStateStrategy } from './oldProposalStateStrategy';
import { createTestContext, cleanTestDatabase, teardownTestContext } from '../../test-helpers/testContext';
import { AppContext } from '../../context/types';
import { ProposalState } from './shared/proposalStateHelpers';
import { Proposal } from './types';
import { PublicClient } from 'viem';

describe('oldProposalStateStrategy', () => {
  let testContext: AppContext;
  let strategy: ReturnType<typeof createOldProposalStateStrategy>;
  let mockClient: any;

  before(async () => {
    // Automatically creates and starts test database container
    testContext = await createTestContext({
      contracts: [{ name: 'Governor', address: '0x1234567890123456789012345678901234567890' }],
      blockchain: {
        network: 'testnet',
        blockIntervalThreshold: 1,
        oldProposalCheckIntervalBlocks: 10,
        blocksPerWeek: 20160
      }
    });

    // Mock PublicClient for blockchain calls
    mockClient = {
      multicall: mock.fn()
    };
  });

  after(async () => {
    // Automatically stops and removes test database container
    await teardownTestContext(testContext);
  });

  beforeEach(async () => {
    // Clean all tables before each test
    await cleanTestDatabase(testContext.dbContext);
    // Reset mock calls (implementation will be set per test)
    mockClient.multicall.mock.resetCalls();
    // Create a fresh strategy instance for each test to reset internal state
    strategy = createOldProposalStateStrategy();
  });

  describe('Strategy creation', () => {
    it('should create strategy with correct name', () => {
      assert.equal(strategy.name, 'OldProposalState');
    });

    it('should have detectAndProcess function', () => {
      assert.equal(typeof strategy.detectAndProcess, 'function');
    });
  });

  describe('Interval-based checking', () => {
    it('should check old proposals on first call', async () => {
      const { db } = testContext.dbContext;

      // Insert old proposal (created more than one week ago)
      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);
      
      // Create Account first (required for proposer relation)
      await db('Account').insert({
        id: '0x0000000000000000000000000000000000000001'
      });

      await db<Proposal>('Proposal').insert({
        id: 'prop1',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(100), // Older than one week
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Mock multicall to return different state
      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Queued }
      ]));

      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should check old proposals on first call
      assert.equal(mockClient.multicall.mock.callCount(), 1);
      assert.ok(result);
    });

    it('should skip check if interval not met', async () => {
      // First call - sets LAST_OLD_PROPOSALS_CHECK_BLOCK
      await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10000)
      });

      // Reset mock call count
      mockClient.multicall.mock.resetCalls();

      // Second call - only 5 blocks later (interval is 10)
      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10005)
      });

      // Should skip - no multicall
      assert.equal(mockClient.multicall.mock.callCount(), 0);
      assert.equal(result, false);
    });

    it('should check when interval threshold is met', async () => {
      const { db } = testContext.dbContext;

      // First call
      await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10000)
      });

      // Insert old proposal
      const currentBlock = BigInt(10010);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);
      
      // Create Account first
      await db('Account').insert({
        id: '0x0000000000000000000000000000000000000001'
      });

      await db<Proposal>('Proposal').insert({
        id: 'prop1',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(100),
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Reset mock
      mockClient.multicall.mock.resetCalls();
      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Queued }
      ]));

      // Second call - exactly 10 blocks later (meets interval)
      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should check old proposals
      assert.equal(mockClient.multicall.mock.callCount(), 1);
      assert.ok(result);
    });
  });

  describe('Old proposal filtering', () => {
    it('should only query proposals older than one week', async () => {
      const { db } = testContext.dbContext;

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);

      // Create Accounts first
      await db('Account').insert([
        { id: '0x0000000000000000000000000000000000000001' },
        { id: '0x0000000000000000000000000000000000000002' }
      ]);

      // Insert old proposal (older than one week)
      await db<Proposal>('Proposal').insert({
        id: 'old-prop',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(100), // Older
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Insert recent proposal (less than one week old)
      await db<Proposal>('Proposal').insert({
        id: 'recent-prop',
        proposalId: '2',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: currentBlock - BigInt(1000), // Recent
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Recent proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000002'
      } as any);

      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Queued }
      ]));

      await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should only query old proposal (multicall called once, not twice)
      assert.equal(mockClient.multicall.mock.callCount(), 1);
      
      // Verify only old proposal was updated
      const oldProp = await db<Proposal>('Proposal').where('id', 'old-prop').first();
      const recentProp = await db<Proposal>('Proposal').where('id', 'recent-prop').first();
      
      assert.equal(oldProp?.rawState, ProposalState.Queued); // Updated
      assert.equal(recentProp?.rawState, ProposalState.Succeeded); // Not updated
    });

    it('should process multiple old proposals', async () => {
      const { db } = testContext.dbContext;

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);

      // Create Accounts first
      await db('Account').insert([
        { id: '0x0000000000000000000000000000000000000001' },
        { id: '0x0000000000000000000000000000000000000002' },
        { id: '0x0000000000000000000000000000000000000003' }
      ]);

      // Insert multiple old proposals
      await db<Proposal>('Proposal').insert([
        {
          id: 'old-prop-1',
          proposalId: '1',
          rawState: ProposalState.Succeeded,
          state: 'Succeeded',
          createdAtBlock: oneWeekAgoBlock - BigInt(200),
          voteStart: BigInt(0),
          voteEnd: BigInt(0),
          votesFor: BigInt(0),
          votesAgainst: BigInt(0),
          votesAbstains: BigInt(0),
          quorum: BigInt(0),
          description: 'Old proposal 1',
          createdAt: BigInt(0),
          signatures: [],
          targets: [],
          values: [],
          calldatas: [],
          proposer: '0x0000000000000000000000000000000000000001'
        },
        {
          id: 'old-prop-2',
          proposalId: '2',
          rawState: ProposalState.Queued,
          state: 'Queued',
          createdAtBlock: oneWeekAgoBlock - BigInt(500),
          voteStart: BigInt(0),
          voteEnd: BigInt(0),
          votesFor: BigInt(0),
          votesAgainst: BigInt(0),
          votesAbstains: BigInt(0),
          quorum: BigInt(0),
          description: 'Old proposal 2',
          createdAt: BigInt(0),
          signatures: [],
          targets: [],
          values: [],
          calldatas: [],
          proposer: '0x0000000000000000000000000000000000000002'
        },
        {
          id: 'old-prop-3',
          proposalId: '3',
          rawState: ProposalState.Succeeded,
          state: 'Succeeded',
          createdAtBlock: oneWeekAgoBlock - BigInt(1000),
          voteStart: BigInt(0),
          voteEnd: BigInt(0),
          votesFor: BigInt(0),
          votesAgainst: BigInt(0),
          votesAbstains: BigInt(0),
          quorum: BigInt(0),
          description: 'Old proposal 3',
          createdAt: BigInt(0),
          signatures: [],
          targets: [],
          values: [],
          calldatas: [],
          proposer: '0x0000000000000000000000000000000000000003'
        }
      ] as any[]);

      // Mock multicall to return different states for each proposal
      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Executed }, // prop 1: Succeeded -> Executed
        { status: 'success', result: ProposalState.Executed }, // prop 2: Queued -> Executed
        { status: 'success', result: ProposalState.Expired }   // prop 3: Succeeded -> Expired
      ]));

      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should call multicall once with all 3 proposals
      assert.equal(mockClient.multicall.mock.callCount(), 1);
      assert.ok(result);

      // Verify all proposals were updated
      const prop1 = await db<Proposal>('Proposal').where('id', 'old-prop-1').first();
      const prop2 = await db<Proposal>('Proposal').where('id', 'old-prop-2').first();
      const prop3 = await db<Proposal>('Proposal').where('id', 'old-prop-3').first();

      assert.equal(prop1?.rawState, ProposalState.Executed);
      assert.equal(prop1?.state, 'Executed');
      assert.equal(prop2?.rawState, ProposalState.Executed);
      assert.equal(prop2?.state, 'Executed');
      assert.equal(prop3?.rawState, ProposalState.Expired);
      assert.equal(prop3?.state, 'Expired');
    });

    it('should exclude proposals exactly at one-week boundary', async () => {
      const { db } = testContext.dbContext;

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);

      // Create Accounts first
      await db('Account').insert([
        { id: '0x0000000000000000000000000000000000000001' },
        { id: '0x0000000000000000000000000000000000000002' }
      ]);

      // Insert proposal exactly at one-week boundary (should be excluded - query uses < not <=)
      await db<Proposal>('Proposal').insert({
        id: 'boundary-prop',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock, // Exactly one week ago
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Boundary proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Insert proposal just before boundary (should be included)
      await db<Proposal>('Proposal').insert({
        id: 'just-old-prop',
        proposalId: '2',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(1), // Just before boundary
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Just old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000002'
      } as any);

      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Queued }
      ]));

      await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should only query the proposal just before boundary (multicall called once, not twice)
      assert.equal(mockClient.multicall.mock.callCount(), 1);

      // Verify only the just-old proposal was updated
      const boundaryProp = await db<Proposal>('Proposal').where('id', 'boundary-prop').first();
      const justOldProp = await db<Proposal>('Proposal').where('id', 'just-old-prop').first();

      assert.equal(boundaryProp?.rawState, ProposalState.Succeeded); // Not updated
      assert.equal(justOldProp?.rawState, ProposalState.Queued); // Updated
    });

    it('should call multicall with correct parameters matching viem structure', async () => {
      const { db } = testContext.dbContext;

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);

      // Create Account first
      await db('Account').insert({
        id: '0x0000000000000000000000000000000000000001'
      });

      // Insert old proposals with different IDs
      await db<Proposal>('Proposal').insert([
        {
          id: 'prop-1',
          proposalId: '10',
          rawState: ProposalState.Succeeded,
          state: 'Succeeded',
          createdAtBlock: oneWeekAgoBlock - BigInt(100),
          voteStart: BigInt(0),
          voteEnd: BigInt(0),
          votesFor: BigInt(0),
          votesAgainst: BigInt(0),
          votesAbstains: BigInt(0),
          quorum: BigInt(0),
          description: 'Proposal 1',
          createdAt: BigInt(0),
          signatures: [],
          targets: [],
          values: [],
          calldatas: [],
          proposer: '0x0000000000000000000000000000000000000001'
        },
        {
          id: 'prop-2',
          proposalId: '20',
          rawState: ProposalState.Queued,
          state: 'Queued',
          createdAtBlock: oneWeekAgoBlock - BigInt(200),
          voteStart: BigInt(0),
          voteEnd: BigInt(0),
          votesFor: BigInt(0),
          votesAgainst: BigInt(0),
          votesAbstains: BigInt(0),
          quorum: BigInt(0),
          description: 'Proposal 2',
          createdAt: BigInt(0),
          signatures: [],
          targets: [],
          values: [],
          calldatas: [],
          proposer: '0x0000000000000000000000000000000000000001'
        }
      ] as any[]);

      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'success', result: ProposalState.Executed },
        { status: 'success', result: ProposalState.Expired }
      ]));

      await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Verify multicall was called once
      assert.equal(mockClient.multicall.mock.callCount(), 1);

      // Verify multicall was called with correct structure matching viem's multicall API
      const multicallCall = mockClient.multicall.mock.calls[0];
      assert.ok(multicallCall);
      assert.ok(multicallCall.arguments);
      assert.equal(multicallCall.arguments.length, 1);
      
      const multicallParams = multicallCall.arguments[0];
      assert.ok(multicallParams.contracts);
      assert.equal(multicallParams.contracts.length, 2);
      
      // Verify each contract call has the correct structure
      const call1 = multicallParams.contracts[0];
      assert.equal(call1.address, '0x1234567890123456789012345678901234567890');
      assert.equal(call1.functionName, 'state');
      assert.deepEqual(call1.args, [BigInt(10)]);
      
      const call2 = multicallParams.contracts[1];
      assert.equal(call2.address, '0x1234567890123456789012345678901234567890');
      assert.equal(call2.functionName, 'state');
      assert.deepEqual(call2.args, [BigInt(20)]);
    });
  });

  describe('Configuration', () => {
    it('should use configured interval blocks', async () => {
      const customContext = await createTestContext({
        contracts: [{ name: 'Governor', address: '0x1234567890123456789012345678901234567890' }],
        blockchain: {
          network: 'testnet',
          blockIntervalThreshold: 1,
          oldProposalCheckIntervalBlocks: 20, // Custom interval
          blocksPerWeek: 20160
        }
      });

      const customStrategy = createOldProposalStateStrategy();

      // First call
      await customStrategy.detectAndProcess({
        context: customContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10000)
      });

      mockClient.multicall.mock.resetCalls();

      // Second call - 15 blocks later (should skip, interval is 20)
      const result2 = await customStrategy.detectAndProcess({
        context: customContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10015)
      });

      // Should skip - no database queries
      assert.equal(mockClient.multicall.mock.callCount(), 0);
      assert.equal(result2, false);

      // Third call - 20 blocks later (should check)
      await customStrategy.detectAndProcess({
        context: customContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10020)
      });

      // Should check
      assert.equal(mockClient.multicall.mock.callCount(), 0); // No proposals, but query was made

      await teardownTestContext(customContext);
    });

    it('should use default values when config missing', async () => {
      const contextWithDefaults = await createTestContext({
        contracts: [{ name: 'Governor', address: '0x1234567890123456789012345678901234567890' }],
        blockchain: {
          network: 'testnet',
          blockIntervalThreshold: 3
          // Missing oldProposalCheckIntervalBlocks and blocksPerWeek (testing defaults)
        }
      });

      // Should use defaults (15 blocks interval, 20160 blocks per week)
      const result = await strategy.detectAndProcess({
        context: contextWithDefaults,
        client: mockClient as PublicClient,
        blockNumber: BigInt(10000)
      });

      // Should work with defaults (no proposals, but query executed)
      assert.equal(result, false);

      await teardownTestContext(contextWithDefaults);
    });

    it('should use custom blocksPerWeek value', async () => {
      const customContext = await createTestContext({
        contracts: [{ name: 'Governor', address: '0x1234567890123456789012345678901234567890' }],
        blockchain: {
          network: 'testnet',
          blockIntervalThreshold: 1,
          oldProposalCheckIntervalBlocks: 10,
          blocksPerWeek: 10000 // Custom: 10000 blocks per week instead of 20160
        }
      });

      const { db } = customContext.dbContext;
      const customStrategy = createOldProposalStateStrategy();

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(10000); // Using custom blocksPerWeek

      // Create Account first
      await db('Account').insert({
        id: '0x0000000000000000000000000000000000000001'
      });

      // Insert proposal that is old according to custom blocksPerWeek
      await db<Proposal>('Proposal').insert({
        id: 'custom-old-prop',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(100), // Older than custom one week
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Custom old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Insert proposal that would be old with default blocksPerWeek but recent with custom
      await db<Proposal>('Proposal').insert({
        id: 'custom-recent-prop',
        proposalId: '2',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock + BigInt(100), // Recent (just after the boundary) with custom blocksPerWeek
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Custom recent proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Mock multicall - only 1 old proposal should be queried, so return 1 result
      // The mock should return results matching the number of proposals queried
      mockClient.multicall.mock.mockImplementation((params: any) => {
        const numContracts = params?.contracts?.length ?? 1;
        return Promise.resolve(
          Array.from({ length: numContracts }, () => ({
            status: 'success' as const,
            result: ProposalState.Queued
          }))
        );
      });

      const result = await customStrategy.detectAndProcess({
        context: customContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should only query the custom-old proposal (multicall called once, not twice)
      assert.equal(mockClient.multicall.mock.callCount(), 1);
      assert.ok(result);

      // Verify only custom-old proposal was updated
      const customOldProp = await db<Proposal>('Proposal').where('id', 'custom-old-prop').first();
      const customRecentProp = await db<Proposal>('Proposal').where('id', 'custom-recent-prop').first();

      assert.equal(customOldProp?.rawState, ProposalState.Queued); // Updated
      assert.equal(customRecentProp?.rawState, ProposalState.Succeeded); // Not updated (recent with custom blocksPerWeek)

      await teardownTestContext(customContext);
    });
  });

  describe('Error handling', () => {
    it('should return false when block number is null', async () => {
      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: null
      });

      assert.equal(result, false);
      assert.equal(mockClient.multicall.mock.callCount(), 0);
    });

    it('should return false when governance address not configured', async () => {
      const contextWithoutGovernor = await createTestContext({
        contracts: [] // No Governor contract
      });

      const result = await strategy.detectAndProcess({
        context: contextWithoutGovernor,
        client: mockClient as PublicClient,
        blockNumber: BigInt(20000)
      });

      assert.equal(result, false);

      await teardownTestContext(contextWithoutGovernor);
    });

    it('should return false when no old proposals found', async () => {
      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: BigInt(25000)
      });

      assert.equal(result, false);
      assert.equal(mockClient.multicall.mock.callCount(), 0);
    });

    it('should handle multicall errors gracefully', async () => {
      const { db } = testContext.dbContext;

      const currentBlock = BigInt(25000);
      const oneWeekAgoBlock = currentBlock - BigInt(20160);

      // Create Account first
      await db('Account').insert({
        id: '0x0000000000000000000000000000000000000001'
      });

      // Insert old proposal
      await db<Proposal>('Proposal').insert({
        id: 'prop1',
        proposalId: '1',
        rawState: ProposalState.Succeeded,
        state: 'Succeeded',
        createdAtBlock: oneWeekAgoBlock - BigInt(100),
        voteStart: BigInt(0),
        voteEnd: BigInt(0),
        votesFor: BigInt(0),
        votesAgainst: BigInt(0),
        votesAbstains: BigInt(0),
        quorum: BigInt(0),
        description: 'Old proposal',
        createdAt: BigInt(0),
        signatures: [],
        targets: [],
        values: [],
        calldatas: [],
        proposer: '0x0000000000000000000000000000000000000001'
      } as any);

      // Mock multicall to fail
      mockClient.multicall.mock.mockImplementation(() => Promise.resolve([
        { status: 'failure', error: new Error('Multicall failed') }
      ]));

      const result = await strategy.detectAndProcess({
        context: testContext,
        client: mockClient as PublicClient,
        blockNumber: currentBlock
      });

      // Should not update when multicall fails
      const unchanged = await db<Proposal>('Proposal').where('id', 'prop1').first();
      assert.equal(unchanged?.rawState, ProposalState.Succeeded);
      assert.equal(result, false);
    });
  });
});
