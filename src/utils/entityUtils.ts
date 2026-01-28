/**
 * Checks if an entity name should be ignored/skipped during processing.
 * These entities are internal tracking entities and should not be synced or processed
 * as regular entities.
 * 
 * @param name The entity name to check
 * @returns true if the entity should be ignored, false otherwise
 */
export const isIgnorableEntity = (name: string): boolean =>
  name === 'LastProcessedBlock' || name === 'EntityChangeLog';
