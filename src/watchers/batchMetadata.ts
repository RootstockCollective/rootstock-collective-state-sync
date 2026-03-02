import log from 'loglevel';

import { AppContext } from '../context/types';
import { GraphQlContext } from '../context/subgraphProvider';

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
