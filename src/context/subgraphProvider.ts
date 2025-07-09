import log from 'loglevel';

import { SubgraphProvider } from '../config/types';
import { buildBatchQuery } from '../handlers/subgraphQueryBuilder';
import { EntityDataCollection, EntityRecord, WithMetadata } from '../handlers/types';
import { pluralizeEntityName } from '../utils/pluralizeEntityName';

interface GraphQLMetadata {
    block: {
        number: BigInt;
        hash: string;
        timestamp: BigInt;
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

    try {
        const batchQuery = buildBatchQuery(
            requests.map((req, index) => ({ index, request: req }))
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
        const apiResponseData = await response.json() as GraphQLResponse<EntityRecord>;

        if (apiResponseData.errors) {
            log.error('GraphQL query that caused error:', batchQuery);
            throw new Error(`GraphQL errors: ${JSON.stringify(apiResponseData.errors)}`);
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

        return metadata ? { ...results, _meta: metadata } as EntityDataCollection<WithMetadata> : results;
    } catch (error) {
        log.error('Error executing GraphQL requests:', error);
        // We should not throw an error here, because in the next block emitted we can get all the data from the previous blocks
        return {};
    }
}

// Factory function to create a TheGraph context
const createSubgraphContext = ({ url, id, maxRowsPerRequest, apiKey }: SubgraphProvider): GraphQlContext => ({
    endpoint: `${url}/${apiKey}/${id}`,
    pagination: {
        maxRowsPerRequest
    }
});

export { createTheGraphContext, executeRequests };
export type { GraphQlContext, GraphQLMetadata, GraphQLRequest, GraphQLResponse };

