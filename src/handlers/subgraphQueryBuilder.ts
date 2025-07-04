import { Entity, Column } from '../config/types';
import { toCamelCase } from '../utils/toCamelCase';
import { GraphQLRequest } from '../context/subgraphProvider';
import { DatabaseSchema } from '../context/schema';
import { pluralizeEntityName } from '../utils/pluralizeEntityName';

interface BatchQueryRequest {
  query: string;
  index: number;
}

/**
 * Combines multiple GraphQL queries into a single batch query
 */
const buildBatchQuery = (requests: BatchQueryRequest[]): string => {
  if (requests.length === 0) {
    throw new Error('Cannot build batch query with empty requests array');
  }

  const queryParts = requests.map(({ query, index }) => {
    const queryName = query.split('(')[0].trim();
    return `${queryName}_${index}: ${query}`;
  });

  return `query BatchQuery {
    ${queryParts.join('\n    ')}
  }`;
}


interface QueryOptions {
  first?: number;
  order?: {
    by: string;
    direction: 'asc' | 'desc';
  }
  filters?: Record<string, any>;
  alias?: string;
}

/**
 * Creates a GraphQL request object for a single entity
 */
const createEntityQuery = (
  schema: DatabaseSchema,
  entityName: string,
  options: QueryOptions = {}
): GraphQLRequest => {
  const query = generateQuery(schema, entityName, options);
  return { entityName, query }
}

/**
 * Creates multiple GraphQL request objects for multiple entities with the same options
 */
const createEntityQueries = (
  schema: DatabaseSchema,
  entityNames: string[],
  options: QueryOptions = {}
): GraphQLRequest[] => {
  return entityNames.map(entityName => createEntityQuery(schema, entityName, options));
}

/**
 * Generates a GraphQL query for a specific entity with given options
 */
const generateQuery = (
  schema: DatabaseSchema,
  entityName: string,
  options: QueryOptions = {}
): string => {
  const entity = schema.entities.get(entityName);
  if (!entity) {
    throw new Error(`Entity '${entityName}' not found in schema`);
  }

  return buildListQuery(entity, schema, options);
}

/**
 * Builds a GraphQL query for fetching multiple entities (list query)
 */
const buildListQuery = (entity: Entity, schema: DatabaseSchema, options: QueryOptions): string => {
  const fields = buildFieldSelection(entity.columns, schema);
  const entityName = pluralizeEntityName(entity.name);
  const queryName = options.alias ? `${options.alias}: ${entityName}` : entityName;
  
  const queryArgs = buildQueryArguments(options);
  const argsString = queryArgs.length > 0 ? `(${queryArgs.join(', ')})` : '';
  
  return `${queryName}${argsString} {
      ${fields}
    }`;
}

/**
 * Builds the field selection for a GraphQL query based on entity columns
 */
const buildFieldSelection = (columns: Column[], schema: DatabaseSchema): string => {
  return columns
    .map(column => {
      // For foreign key relationships, only select the id field
      if (schema.entities.has(column.type)) {
        return `${column.name} { id }`;
      }
      return column.name;
    })
    .join('\n      ');
}

/**
 * Formats a value for GraphQL query arguments
 */
const formatQueryValue = (value: any): string => {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: ${formatQueryValue(v)}`)
      .join(', ');
    return `{ ${entries} }`;
  }
  return String(value);
}

/**
 * Builds query arguments array for GraphQL queries
 */
const buildQueryArguments = (options: QueryOptions): string[] => {
  const queryArgs: string[] = [];

  if (options.first !== undefined) {
    queryArgs.push(`first: ${options.first}`);
  }

  if (options.order) {
    queryArgs.push(`orderBy: ${options.order.by}`);
    queryArgs.push(`orderDirection: ${options.order.direction}`);
  }

  if (options.filters) {
    const whereClause = Object.entries(options.filters)
      .map(([key, value]) => `${key}: ${formatQueryValue(value)}`)
      .join(', ');

    if (whereClause) {
      queryArgs.push(`where: { ${whereClause} }`);
    }
  }

  return queryArgs;
}

export { createEntityQuery, createEntityQueries, buildBatchQuery }
