import { toCamelCase } from "./toCamelCase";

/**
 * Transforms an entity name to its plural form in camelCase
 * @param name The entity name to transform
 * @returns The plural form in camelCase
 * @example
 * pluralizeEntityName('BlockChangeLog') // 'blockChangeLogs'
 * pluralizeEntityName('Entity') // 'entities'
 */
const pluralizeEntityName = (name: string): string => {

    return name.endsWith('y') 
        ? toCamelCase(name.slice(0, -1)) + 'ies'
        : toCamelCase(name) + 's';
} 

export { pluralizeEntityName }
