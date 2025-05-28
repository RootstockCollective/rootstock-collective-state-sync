import { Entity } from '../config/config';
import { DatabaseSchema } from '../handlers/types';

// Pure function to create schema context from config
export const createSchemaContext = (entities: Entity[]): DatabaseSchema => ({
    entities: new Map(
        entities
            .map(entity => [entity.name, entity])
    )
}); 