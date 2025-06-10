import log from 'loglevel';

import { buildBatchQuery } from '../handlers/subgraphQueryBuilder';
import { pluralizeEntityName } from '../utils/pluralizeEntityName';
import { SubgraphProvider } from '../config/types';
import { EntityDataCollection, EntityRecord } from '../handlers/types';

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
): Promise<EntityDataCollection> => {

    try {
        const batchQuery = buildBatchQuery(
            requests.map((req, index) => ({ query: req.query, index }))
        );
        log.debug("🚀 ~ batchQuery:", batchQuery);


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

        // The graph always requires an id field
        // The id field is a string or bytes and is the primary key of the entity
        // See https://thegraph.com/docs/en/subgraphs/developing/creating/ql-schema/#optional-and-required-fields
        const result = await response.json() as GraphQLResponse<EntityRecord>;

        if (result.errors) {
            log.error('GraphQL query that caused error:', batchQuery);
            throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        const results: EntityDataCollection = {};
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
            results[request.entityName] = data;
        }

        return results;
    } catch (error) {
        log.error('Error executing GraphQL requests:', error);
        // We should not throw an error here, because in the next block emitted we can get all the data from the previous blocks
        return {};
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
