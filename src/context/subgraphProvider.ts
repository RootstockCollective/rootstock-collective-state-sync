import log from 'loglevel';

import { buildBatchQuery } from '../handlers/subgraphQueryBuilder';
import { pluralizeEntityName } from '../utils/entityName';
import { SubgraphProvider } from '../config/types';

interface GraphQLRequest {
    query: string;
    entityName: string;
}

interface GraphQLResponse<T> {
    data: {
        [key: string]: T[];
    }
    errors?: Array<{
        message: string;
        locations: Array<{ line: number; column: number }>;
    }>;
}

interface GraphQlContext {
    endpoint: string;
    pagination: {
        maxRowsPerRequest: number;
    }
}

// Function to execute a batch of requests
const executeRequests = async (
    context: GraphQlContext,
    requests: GraphQLRequest[]
): Promise<Map<string, any[]>> => {

    try {

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
            log.error('GraphQL query that caused error:', batchQuery);
            throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        const results = new Map<string, any[]>();
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            const entityName = pluralizeEntityName(request.entityName);
            const queryKey = `${entityName}_${i}`;
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
    } catch (error) {
        log.error('Error executing GraphQL requests:', error);
        return new Map<string, any[]>(); // Return empty map instead of throwing
    }
}

// Factory function to create a TheGraph context
const createTheGraphContext = ({ url, id, maxRowsPerRequest, apiKey }: SubgraphProvider): GraphQlContext => ({
    endpoint: `${url}/${apiKey}/${id}`,
    pagination: {
        maxRowsPerRequest
    }
});

export { createTheGraphContext, executeRequests }
export type { GraphQLRequest, GraphQLResponse, GraphQlContext }
