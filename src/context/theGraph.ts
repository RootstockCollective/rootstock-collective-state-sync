import log from 'loglevel';

import { TheGraph } from '../config/config';
import { buildBatchQuery } from '../handlers/queryBuilder';
import { transformEntityName } from '../utils/entityName';

export interface GraphQLRequest {
    query: string;
    entityName: string;
}

export interface GraphQLResponse<T> {
    data: {
        [key: string]: T[];
    };
    errors?: Array<{
        message: string;
        locations: Array<{ line: number; column: number }>;
    }>;
}

export interface TheGraphContext {
    endpoint: string;
    pagination: {
        maxRowsPerRequest: number;
    };
}

// Function to execute a batch of requests
export const executeRequests = async (
    context: TheGraphContext,
    requests: GraphQLRequest[]
): Promise<Map<string, any[]>> => {

    const batchQuery = buildBatchQuery(
        requests.map((req, index) => ({ query: req.query, index }))
    );
    log.info("🚀 ~ batchQuery:", batchQuery);

    const response = await fetch(context.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: batchQuery
        }),
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as GraphQLResponse<any>;

    if (result.errors) {
        console.error('GraphQL query that caused error:', batchQuery);
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    const results = new Map<string, any[]>();
    for (const request of requests) {
        const entityName = transformEntityName(request.entityName);
        const queryKey = `${entityName}_${requests.indexOf(request)}`;
        const data = result.data[queryKey] || [];
        log.info(`Processing response for ${request.entityName}:`, {
            queryKey,
            dataLength: data.length,
            firstId: data[0]?.id,
            lastId: data[data.length - 1]?.id
        });
        results.set(request.entityName, data);
    }

    return results;
};

// Factory function to create a TheGraph context
export const createTheGraphContext = ({ endpoint, maxRowsPerRequest }: TheGraph): TheGraphContext => ({
    endpoint,
    pagination: {
        maxRowsPerRequest
    }
});