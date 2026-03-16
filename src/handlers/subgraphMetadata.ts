import log from 'loglevel';

import { GraphQLMetadata } from '../context/subgraphProvider';
import { AppContext } from '../context/types';

interface SubgraphMetadataRecord {
  id: string;
  blockNumber: bigint | string;
  blockHash: string;
  blockTimestamp: bigint | string;
  deployment: string;
  hasIndexingErrors: boolean;
}

/**
 * Persists subgraph metadata (_meta from GraphQL) into the SubgraphMetadata table.
 * No-op if the schema does not define SubgraphMetadata.
 */
export const saveSubgraphMetadata = async (
  context: AppContext,
  subgraphName: string,
  metadata: GraphQLMetadata
): Promise<void> => {
  log.debug('[saveSubgraphMetadata] reached', { subgraphName });
  if (!context.schema.entities.has('SubgraphMetadata')) {
    return;
  }

  try {
    await context.dbContext.db<SubgraphMetadataRecord>('SubgraphMetadata')
      .insert({
        id: subgraphName,
        blockNumber: metadata.block.number,
        blockHash: metadata.block.hash,
        blockTimestamp: metadata.block.timestamp,
        deployment: metadata.deployment,
        hasIndexingErrors: metadata.hasIndexingErrors,
      })
      .onConflict('id')
      .merge();
    log.info(`Saved SubgraphMetadata for ${subgraphName}`);
  } catch (error) {
    log.error(`Failed to save SubgraphMetadata for ${subgraphName}`, error);
  }
};
