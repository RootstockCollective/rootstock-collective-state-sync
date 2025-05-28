import { toCamelCase } from "./stringUtils";

/**
 * Transforms an entity name to its plural form in camelCase
 * @param name The entity name to transform
 * @returns The plural form in camelCase
 * @example
 * transformEntityName('BlockChangeLog') // 'blockChangeLogs'
 * transformEntityName('Entity') // 'entities'
 */
export const transformEntityName = (name: string): string => {

    return name.endsWith('y') 
        ? toCamelCase(name.slice(0, -1)) + 'ies'
        : toCamelCase(name) + 's';
}; 