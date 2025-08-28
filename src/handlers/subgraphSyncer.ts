import log from 'loglevel';

import { executeRequests } from '../context/subgraphProvider';
import { createEntityQueries } from './subgraphQueryBuilder';
import { executeUpsert } from './dbUpsert';
import { AppContext } from '../context/types';
import { EntityDataCollection } from './types';

interface EntitySyncStatus {
    entityName: string;
    lastProcessedId: string | null;
    isComplete: boolean;
    totalProcessed: number;
}


const createInitialStatus = (entityName: string): EntitySyncStatus => ({
    entityName,
    lastProcessedId: null,
    isComplete: false,
    totalProcessed: 0
})

const updateStatus = (
    currentStatus: EntitySyncStatus,
    lastId: string | null,
    processedCount: number,
    maxRowsPerRequest: number
): EntitySyncStatus => {
    const isComplete = processedCount < maxRowsPerRequest;
    return {
        ...currentStatus,
        lastProcessedId: lastId,
        isComplete,
        totalProcessed: currentStatus.totalProcessed + processedCount
    }
}

const buildFilters = (lastProcessedId: string | undefined, blockNumber?: bigint) => ({
    ...(lastProcessedId ? { id_gt: lastProcessedId } : { id_gt: '0x00' }),
    ...(blockNumber ? { _change_block: { number_gte: blockNumber } } : {})
});

const collectEntityData = async (
    context: AppContext,
    entities: string[],
    blockNumber?: bigint
): Promise<EntityDataCollection> => {
    const { schema, graphqlContext } = context;
    const entityStatus: Record<string, EntitySyncStatus> = entities.reduce((acc, entityName) => {
        acc[entityName] = createInitialStatus(entityName);
        return acc;
    }, {} as Record<string, EntitySyncStatus>);

    const entityData: EntityDataCollection = {};

    let requests = createEntityQueries(schema, entities, {
        first: graphqlContext.pagination.maxRowsPerRequest,
        filters: buildFilters(undefined, blockNumber)
    });

    while (requests.length > 0) {
        const results = await executeRequests(graphqlContext, requests);

        requests = [];
        for (const [entityName, data] of Object.entries(results)) {
            const currentStatus = entityStatus[entityName];
            if (!currentStatus) {
                throw new Error(`No status found for entity "${entityName}"`);
            }

            const lastId = data.length > 0 ? data[data.length - 1].id : null;
            log.info(`Entity ${entityName}: Last ID from batch: ${lastId}, Records in batch: ${data.length}`);

            const newStatus = updateStatus(
                currentStatus,
                lastId as string | null,
                data.length,
                graphqlContext.pagination.maxRowsPerRequest
            );
            entityStatus[entityName] = newStatus;
            log.info(`Entity ${entityName} status:`, {
                lastProcessedId: newStatus.lastProcessedId,
                isComplete: newStatus.isComplete,
                totalProcessed: newStatus.totalProcessed
            });

            if (!newStatus.isComplete && newStatus.lastProcessedId) {
                const nextQueries = createEntityQueries(schema, [entityName], {
                    first: graphqlContext.pagination.maxRowsPerRequest,
                    filters: buildFilters(newStatus.lastProcessedId, blockNumber)
                });
                requests.push(...nextQueries);
            } else {
                log.info(`No more queries needed for ${entityName}. Complete: ${newStatus.isComplete}, Last ID: ${newStatus.lastProcessedId}`);
            }

            if (data.length > 0) {
                const existingData = entityData[entityName] || [];
                entityData[entityName] = [...existingData, ...data];
            }

            log.info(`Processed ${newStatus.totalProcessed} records for ${entityName}`);
        }

        log.info(`Created ${requests.length} queries for next batch`);
    }

    return entityData;
}

const processEntityData = async (
    context: AppContext,
    entityData: EntityDataCollection
): Promise<void> => {
    const { dbContext, schema } = context;
    log.info('Processing all collected data...');
    for (const [entityName, data] of Object.entries(entityData)) {
        if (data.length > 0) {
            log.info(`Upserting ${data.length} records for ${entityName}`);
            await executeUpsert(dbContext, entityName, data, schema);
        }
    }
    log.info('Completed processing all data');
}

const syncEntities = async (
    context: AppContext,
    entities: string[],
    blockNumber?: bigint
): Promise<void> => {
    const entityData = await collectEntityData(context, entities, blockNumber);
    await processEntityData(context, entityData);
}

export { syncEntities }
