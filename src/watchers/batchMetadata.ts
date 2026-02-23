import log from 'loglevel';

import { AppContext } from '../context/types';
import { GraphQlContext, GraphQLRequest } from '../context/subgraphProvider';
import { createEntityQuery } from '../handlers/subgraphQueryBuilder';

/**
 * Resolves the subgraph name for a batch group from the app context.
 *
 * @param context - App context with graphqlContexts map
 * @param graphqlContext - The GraphQL context (endpoint) for the group
 * @returns The subgraph name, or undefined if not found
 */
export function getSubgraphName(
  context: AppContext,
  graphqlContext: GraphQlContext
): string | undefined {
  const entry = Object.entries(context.graphqlContexts).find(
    ([, ctx]) => ctx === graphqlContext
  );
  const name = entry?.[0];
  if (name !== undefined) {
    log.debug(`[batchMetadata:getSubgraphName] resolved to ${name}`);
  } else {
    log.debug('[batchMetadata:getSubgraphName] no subgraph name found for context');
  }
  return name;
}

/**
 * Builds a minimal GraphQL request that triggers _meta in the batch response.
 * Prefers an entity not already requested in the group to avoid overwriting strategy results.
 *
 * @param context - App context (schema, etc.)
 * @param subgraphName - Name of the subgraph (key in graphqlContexts)
 * @param existingEntityNames - Entity names already in the batch group
 * @returns A request with withMetadata: true, or null if schema has no SubgraphMetadata or no entity for this subgraph
 */
export function getMetadataRequest(
  context: AppContext,
  subgraphName: string,
  existingEntityNames: Set<string>
): GraphQLRequest | null {
  if (!context.schema.entities.has('SubgraphMetadata')) {
    log.debug('[batchMetadata:getMetadataRequest] schema has no SubgraphMetadata, skipping');
    return null;
  }

  const { schema } = context;
  let preferredEntityName: string | null = null;
  let fallbackEntityName: string | null = null;

  for (const [entityName, entity] of schema.entities) {
    if (entity.subgraphProvider !== subgraphName) {
      continue;
    }
    if (fallbackEntityName === null) {
      fallbackEntityName = entityName;
    }
    if (!existingEntityNames.has(entityName)) {
      preferredEntityName = entityName;
      break;
    }
  }

  const entityName = preferredEntityName ?? fallbackEntityName;
  if (entityName === null) {
    log.debug(`[batchMetadata:getMetadataRequest] no entity for subgraph ${subgraphName}, skipping`);
    return null;
  }

  const usedFallback = preferredEntityName === null;
  log.debug(
    `[batchMetadata:getMetadataRequest] subgraph ${subgraphName} using entity ${entityName}${usedFallback ? ' (fallback, may overlap strategy query)' : ''}`
  );
  log.info(`[batchMetadata:getMetadataRequest] adding metadata request for subgraph ${subgraphName} (entity: ${entityName})`);

  return createEntityQuery(schema, entityName, {
    first: 1,
    withMetadata: true,
  });
}
