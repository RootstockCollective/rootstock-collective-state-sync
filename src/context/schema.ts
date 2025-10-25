import { Entity } from '../config/types';

interface DatabaseSchema {
    entities: Map<string, Entity>;
}

// Pure function to create schema context from config
const createSchemaContext = (entities: Entity[]): DatabaseSchema => ({
  entities: new Map(
    entities
      .map(entity => [entity.name, entity])
  )
}); 

export { createSchemaContext };
export type { DatabaseSchema };
