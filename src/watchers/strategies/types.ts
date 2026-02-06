import { PublicClient } from 'viem';
import { AppContext } from '../../context/types';
import { GraphQLRequest, GraphQlContext } from '../../context/subgraphProvider';
import { EntityDataCollection } from '../../handlers/types';

/**
 * Parameters passed to strategy methods during block processing.
 */
interface ChangeStrategyParams {
  /** Application context containing schema, database, and GraphQL contexts */
  context: AppContext;
  /** Blockchain client for RPC calls */
  client: PublicClient;
  /** Current block number being processed (null if unknown) */
  blockNumber: bigint | null;
}

/**
 * Base interface for all block processing strategies.
 * Strategies detect changes in blocks and process them accordingly.
 */
interface ChangeStrategy {
  /** Unique identifier for this strategy */
  name: string;
  /** Main entry point - detects if changes occurred and processes them */
  detectAndProcess: (params: ChangeStrategyParams) => Promise<boolean>;
}

/**
 * Extended strategy interface for strategies that support query batching.
 * 
 * Batching allows multiple strategies to combine their GraphQL queries
 * into a single HTTP request, reducing network overhead.
 * 
 * @example
 * ```typescript
 * const myStrategy: BatchableStrategy = {
 *   name: 'MyStrategy',
 *   canBatch: true,
 *   getSubgraphContext: (ctx) => ctx.graphqlContexts['governance'],
 *   getQueries: async (params) => [createEntityQuery(...)],
 *   processBatchResults: async (results, params) => { ... },
 *   detectAndProcess: async (params) => { ... }
 * };
 * ```
 */
interface BatchableStrategy extends ChangeStrategy {
  /** Whether this strategy can be batched with others */
  canBatch: boolean;

  /**
   * Returns the GraphQL context (endpoint) this strategy queries.
   * Required for batching - strategies using the same endpoint are batched together.
   */
  getSubgraphContext(context: AppContext): GraphQlContext | null;

  /**
   * Returns queries this strategy wants to execute (without executing them).
   * @returns Array of queries, or empty array if strategy shouldn't run
   */
  getQueries(params: ChangeStrategyParams): Promise<GraphQLRequest[]>;

  /**
   * Processes results from a batched query execution.
   * @param results - Entity data keyed by entity name
   * @param params - Strategy execution parameters
   * @returns true if processing succeeded
   */
  processBatchResults(
    results: EntityDataCollection,
    params: ChangeStrategyParams
  ): Promise<boolean>;
}

export type BlockHash = string

interface BlockChangeLog {
  id: BlockHash;
  blockNumber: bigint;
  blockTimestamp: bigint;
  updatedEntities: string[];
}

interface LastProcessedBlock {
  id: boolean; // there will only ever be one last processed block
  hash: BlockHash;
  number: bigint;
  timestamp: bigint;
}
interface Proposal {
  id: string;
  proposalId: string;
  voteStart: bigint;
  voteEnd: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  votesAbstains: bigint;
  quorum: bigint;
  state: string;
  rawState: number;
  createdAtBlock: bigint;
}

export type { ChangeStrategyParams, ChangeStrategy, BatchableStrategy, BlockChangeLog, Proposal, LastProcessedBlock };
