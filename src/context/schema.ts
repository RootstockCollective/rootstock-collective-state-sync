import { Entity } from '../config/types';
import { isArrayColumnType } from '../handlers/types';

interface DatabaseSchema {
  entities: Map<string, Entity>;

  /**
   * Returns entity names in schema (creation) order.
   * Parents come before children.
   */
  getEntityOrder(): string[];

  /**
   * Returns entities filtered to `only`, in FK-safe upsert order.
   * Uses topological sort to ensure parents are inserted before children.
   */
  getUpsertOrder(only?: string[]): string[];

  /**
   * Returns entities filtered to `only`, in FK-safe delete order.
   * Uses reverse topological sort to ensure children are deleted before parents.
   */
  getDeleteOrder(only?: string[]): string[];

  /**
   * Returns child entities that directly reference the given parent entity via foreign keys.
   * Uses precomputed adjacency map for O(1) lookup.
   */
  getDirectChildren(entityName: string): { childEntityName: string; fkColumnName: string }[];
}

/**
 * Performs topological sort on entities based on foreign key dependencies.
 * Returns entities in order where parents come before children.
 */
const topologicalSort = (
  entities: Map<string, Entity>,
  childrenMap: Map<string, { childEntityName: string; fkColumnName: string }[]>,
  only?: string[]
): string[] => {
  const entityNames = only ? Array.from(entities.keys()).filter(name => only.includes(name)) : Array.from(entities.keys());
  const allowed = new Set(entityNames);

  // Build dependency graph: entity -> number of entities it depends on (in-degree)
  // When entity A has FK column pointing to entity B, A depends on B (A must come after B)
  const inDegree = new Map<string, number>();

  // Initialize in-degree for all entities
  for (const entityName of entityNames) {
    inDegree.set(entityName, 0);
  }

  // Build dependency graph by scanning columns
  // When we find a FK column in entity A pointing to entity B, increment A's in-degree
  for (const [entityName, entity] of entities.entries()) {
    if (!allowed.has(entityName)) continue;

    for (const column of entity.columns) {
      if (isArrayColumnType(column.type)) continue; // arrays are NOT FK constraints in DB

      const columnType = column.type;
      if (allowed.has(columnType) && columnType !== entityName) {
        inDegree.set(entityName, (inDegree.get(entityName) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  const result: string[] = [];

  // Start with entities that have no dependencies (in-degree = 0)
  for (const [entityName, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(entityName);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    result.push(current);

    // Find all entities that depend on current (children of current)
    // When current is processed, reduce in-degree of its children
    const children = childrenMap.get(current) ?? [];
    for (const { childEntityName } of children) {
      if (!allowed.has(childEntityName)) continue;

      const childInDegree = inDegree.get(childEntityName) ?? 0;
      if (childInDegree > 0) {
        inDegree.set(childEntityName, childInDegree - 1);

        if (inDegree.get(childEntityName) === 0) {
          queue.push(childEntityName);
        }
      }
    }
  }

  if (result.length !== entityNames.length) {
    const missing = entityNames.filter(n => !result.includes(n));
    throw new Error(`Schema FK cycle detected among: ${missing.join(', ')}`);
  }

  return result;
};

// Pure function to create schema context from config
const createSchemaContext = (entities: Entity[]): DatabaseSchema => {
  const map = new Map(entities.map(entity => [entity.name, entity]));

  // Precompute children adjacency map once
  const childrenMap = new Map<string, { childEntityName: string; fkColumnName: string }[]>();

  for (const [childEntityName, childEntity] of map.entries()) {
    for (const column of childEntity.columns) {
      const columnType = isArrayColumnType(column.type) ? column.type[0] : column.type;
      if (typeof columnType === 'string' && map.has(columnType)) {
        const parentEntityName = columnType;
        const children = childrenMap.get(parentEntityName) ?? [];
        children.push({
          childEntityName,
          fkColumnName: column.name
        });
        childrenMap.set(parentEntityName, children);
      }
    }
  }

  const getEntityOrder = (): string[] =>
    Array.from(map.keys());

  const getUpsertOrder = (only?: string[]): string[] => {
    return topologicalSort(map, childrenMap, only);
  };

  const getDeleteOrder = (only?: string[]): string[] => {
    return getUpsertOrder(only).reverse();
  };

  const getDirectChildren = (entityName: string): { childEntityName: string; fkColumnName: string }[] => {
    return childrenMap.get(entityName) ?? [];
  };

  return {
    entities: map,
    getEntityOrder,
    getUpsertOrder,
    getDeleteOrder,
    getDirectChildren,
  };
};

export { createSchemaContext };
export type { DatabaseSchema };
