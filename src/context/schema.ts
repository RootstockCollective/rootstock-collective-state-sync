import { Entity } from '../config/types';

interface DatabaseSchema {
  entities: Map<string, Entity>;

  /**
   * Returns entity names in schema (creation) order.
   * Parents come before children.
   */
  getEntityOrder(): string[];

  /**
   * Returns entities filtered to `only`, in FK-safe upsert order.
   */
  getUpsertOrder(only?: string[]): string[];

  /**
   * Returns entities filtered to `only`, in FK-safe delete order.
   * (reverse of upsert order)
   */
  getDeleteOrder(only?: string[]): string[];
}

// Pure function to create schema context from config
const createSchemaContext = (entities: Entity[]): DatabaseSchema => {
  const map = new Map(entities.map(entity => [entity.name, entity]));

  const getEntityOrder = (): string[] =>
    Array.from(map.keys());

  const getUpsertOrder = (only?: string[]): string[] => {
    if (!only) return getEntityOrder();
    const allowed = new Set(only);
    return getEntityOrder().filter(name => allowed.has(name));
  };

  const getDeleteOrder = (only?: string[]): string[] =>
    getUpsertOrder(only).reverse();

  return {
    entities: map,
    getEntityOrder,
    getUpsertOrder,
    getDeleteOrder,
  };
};

export { createSchemaContext };
export type { DatabaseSchema };
