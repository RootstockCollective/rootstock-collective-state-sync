import log from 'loglevel';

import { SubgraphProvider } from '../config/types';
import { buildBatchQuery } from '../handlers/subgraphQueryBuilder';
import { EntityDataCollection, EntityRecord, WithMetadata } from '../handlers/types';
import { pluralizeEntityName } from '../utils/pluralizeEntityName';

// Type definitions for metrics
interface RequestHistoryEntry {
  timestamp: number;
  provider: string;
  queryCount: number;
  success: boolean;
  duration?: number;
  error?: string;
}

interface HttpRequestLogEntry {
  url: string;
  method: string;
  timestamp: number;
  queryCount: number;
  duration?: number;
}

// Request counting and metrics - scoped to avoid redeclaration errors
const metrics: {
  requestCount: number;
  requestHistory: RequestHistoryEntry[];
  httpRequestCount: number;
  httpRequestLog: HttpRequestLogEntry[];
} = {
  requestCount: 0,
  requestHistory: [],
  httpRequestCount: 0,
  httpRequestLog: []
};

interface GraphQLMetadata {
    block: {
        number: bigint;
        hash: string;
        timestamp: bigint;
    };
    deployment: string;
    hasIndexingErrors: boolean;
}

interface GraphQLRequest {
    query: string;
    entityName: string;
    withMetadata?: boolean;
}

interface GraphQLResponse<T> {
    data: Record<string, T[]>;
    errors?: {
        message: string;
        locations: { line: number; column: number }[];
    }[];
}

interface GraphQlContext {
    endpoint: string;
    pagination: {
        maxRowsPerRequest: number;
    }
}

// Function to execute a batch of requests
const executeRequests = async <Requests extends readonly GraphQLRequest[]>(
  context: GraphQlContext,
  requests: Requests
): Promise<Pick<Requests[number], 'withMetadata'> extends WithMetadata
    ? EntityDataCollection<WithMetadata>
    : EntityDataCollection<false>> => {
  const startTime = Date.now();
  const queryCount = requests.length;
  
  // Increment counter
  metrics.requestCount++;
  
  // Log request
  const requestEntry: {
    timestamp: number;
    provider: string;
    queryCount: number;
    success: boolean;
    duration?: number;
    error?: string;
  } = {
    timestamp: startTime,
    provider: context.endpoint,
    queryCount,
    success: false
  };
  metrics.requestHistory.push(requestEntry);

  log.info(`[RequestCounter] Request #${metrics.requestCount}: ${queryCount} query(ies) to ${context.endpoint}`);

  // Count queries in batch for HTTP metrics
  // Use requests.length directly - more reliable than regex parsing
  // The regex could match false positives in query bodies
  const actualQueryCount = requests.length;

  try {
    const batchQuery = buildBatchQuery(
      requests.map((req, index) => ({ index, request: req }))
    );
    log.debug('🚀 ~ batchQuery:', batchQuery);

    const httpStartTime = Date.now();
    
    // Track HTTP request attempt (even if it fails)
    // This ensures we count all HTTP requests, not just successful ones
    metrics.httpRequestCount++;
    const httpRequestLogEntry: HttpRequestLogEntry = {
      url: context.endpoint,
      method: 'POST',
      timestamp: httpStartTime,
      queryCount: actualQueryCount
    };
    
    const response = await fetch(context.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: batchQuery
      }),
    });
    const httpDuration = Date.now() - httpStartTime;

    // Update log entry with duration (successful request)
    httpRequestLogEntry.duration = httpDuration;
    metrics.httpRequestLog.push(httpRequestLogEntry);

    log.info(`[HTTP Interceptor] Request #${metrics.httpRequestCount}: ${actualQueryCount} query(ies) to ${context.endpoint} (${httpDuration}ms)`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // The graph always requires an id field
    // The id field is a string or bytes and is the primary key of the entity
    // See https://thegraph.com/docs/en/subgraphs/developing/creating/ql-schema/#optional-and-required-fields
    const apiResponseData = await response.json() as GraphQLResponse<EntityRecord>;

    if (apiResponseData.errors) {
      log.error('GraphQL query that caused error:', batchQuery);
      throw new Error(`GraphQL errors: ${JSON.stringify(apiResponseData.errors)}`);
    }

    // Handle case when data is null/undefined (e.g., subgraph not deployed or empty)
    if (!apiResponseData.data) {
      log.warn('GraphQL response has no data field - subgraph may not be deployed or synced');
      const duration = Date.now() - startTime;
      requestEntry.success = true;
      requestEntry.duration = duration;
      return {};
    }

    const [entities, metadata] = Object.keys(apiResponseData.data)
      .reduce((acc, key) => {
        if (key === '_meta') {
          acc[1] = apiResponseData.data[key] as unknown as GraphQLMetadata;
        } else {
          acc[0][key] = apiResponseData.data[key];
        }
        return acc;
      }, [{}, undefined] as [EntityDataCollection, GraphQLMetadata | undefined]);

    const results: EntityDataCollection = {};
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const entityName = pluralizeEntityName(request.entityName);
      const queryKey = `${entityName}_${i}`;
      const data = entities[queryKey] || [];
      log.info(`Processing response for ${request.entityName}:`, {
        queryKey,
        dataLength: data.length,
        firstId: data[0]?.id,
        lastId: data[data.length - 1]?.id
      });
      results[request.entityName] = data;
    }

    const duration = Date.now() - startTime;
    requestEntry.success = true;
    requestEntry.duration = duration;
    log.info(`[RequestCounter] Request #${metrics.requestCount} completed in ${duration}ms`);

    return metadata ? { ...results, _meta: metadata } as EntityDataCollection<WithMetadata> : results;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    requestEntry.success = false;
    requestEntry.duration = duration;
    requestEntry.error = errorMessage;
    
    // If HTTP request was attempted but failed, ensure it's logged
    // httpRequestCount was already incremented before fetch, but log entry might be missing
    // if fetch threw before we could push the entry
    if (metrics.httpRequestLog.length < metrics.httpRequestCount) {
      // Estimate start time based on duration (approximate)
      const estimatedStartTime = Date.now() - duration;
      metrics.httpRequestLog.push({
        url: context.endpoint,
        method: 'POST',
        timestamp: estimatedStartTime,
        queryCount: actualQueryCount,
        duration: duration
      });
      log.info(`[HTTP Interceptor] Request #${metrics.httpRequestCount}: ${actualQueryCount} query(ies) to ${context.endpoint} (FAILED after ${duration}ms)`);
    }
    
    log.error(`[RequestCounter] Request #${metrics.requestCount} failed in ${duration}ms:`, error);
    log.error('Error executing GraphQL requests:', error);
    // We should not throw an error here, because in the next block emitted we can get all the data from the previous blocks
    return {};
  }
};

// Factory function to create a TheGraph context
const createTheGraphContext = ({ url, id, maxRowsPerRequest, apiKey }: SubgraphProvider): GraphQlContext => {
  // Build endpoint URL, handling empty apiKey to avoid double slashes
  const endpoint = apiKey 
    ? `${url}/${apiKey}/${id}`
    : `${url}/subgraphs/name/${id}`;
  
  return {
    endpoint,
    pagination: {
      maxRowsPerRequest
    }
  };
};

// Export metrics functions
function getRequestMetrics() {
  return {
    totalRequests: metrics.requestCount,
    history: [...metrics.requestHistory],
    reset: () => {
      metrics.requestCount = 0;
      metrics.requestHistory = [];
    }
  };
}

function getHttpMetrics() {
  return {
    totalHttpRequests: metrics.httpRequestCount,
    log: [...metrics.httpRequestLog],
    reset: () => {
      metrics.httpRequestCount = 0;
      metrics.httpRequestLog = [];
    }
  };
}

export { createTheGraphContext, executeRequests, getRequestMetrics, getHttpMetrics };
export type { GraphQlContext, GraphQLMetadata, GraphQLRequest, GraphQLResponse };

