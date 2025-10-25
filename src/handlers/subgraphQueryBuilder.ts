import { Column, Entity } from '../config/types';
import { DatabaseSchema } from '../context/schema';
import { GraphQLRequest } from '../context/subgraphProvider';
import { pluralizeEntityName } from '../utils/pluralizeEntityName';

interface BatchQueryRequest {
  request: GraphQLRequest;
  index: number;
}

/**
 * Combines multiple GraphQL queries into a single batch query
 */
const buildBatchQuery = (requests: BatchQueryRequest[]): string => {
  if (requests.length === 0) {
    throw new Error('Cannot build batch query with empty requests array');
  }

  const queryParts = requests.map(({ request: { query }, index }) => {
    // Extract query name: split by '(' for queries with args, or '{' for queries without args
    const queryName = query.split(/[({]/)[0].trim();
    return `${queryName}_${index}: ${query}`;
  });

  const requiresMetadataQuery = requests.some(({ request: { withMetadata } }) => withMetadata);

  const metadataQuery = requiresMetadataQuery ? `
  _meta {
    block {
      number
      hash
      timestamp
    }
    deployment
    hasIndexingErrors
  }
  ` : '';

  return `query BatchQuery {
    ${queryParts.join('\n    ')}
    ${metadataQuery}
  }`;
};

type FilterValue = string | bigint | number | { [key: string]: FilterValue };
interface QueryOptions {
  first?: number;
  order?: {
    by: string;
    direction: 'asc' | 'desc';
  }
  filters?: FilterValue;
  alias?: string;
  withMetadata?: boolean;
}

/**
 * Creates a GraphQL request object for a single entity
 */
const createEntityQuery = (
  schema: DatabaseSchema,
  entityName: string,
  options?: QueryOptions
): GraphQLRequest => {
  const query = generateQuery(schema, entityName, options);
  return { entityName, query, withMetadata: options?.withMetadata ?? false };
};

/**
 * Creates multiple GraphQL request objects for multiple entities with the same options
 */
const createEntityQueries = (
  schema: DatabaseSchema,
  entityNames: string[],
  options?: QueryOptions
): GraphQLRequest[] => {
  return entityNames.map(entityName => createEntityQuery(schema, entityName, options ?? {}));
};

/**
 * Generates a GraphQL query for a specific entity with given options
 */
const generateQuery = (
  schema: DatabaseSchema,
  entityName: string,
  options?: QueryOptions
): string => {
  const entity = schema.entities.get(entityName);
  if (!entity) {
    throw new Error(`Entity '${entityName}' not found in schema`);
  }

  return buildListQuery(entity, schema, options ?? {});
};

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
};

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
};

/**
 * Formats a value for GraphQL query arguments
 */
const formatQueryValue = (value: FilterValue, visited = new WeakSet()): string | undefined => {
  if (value === null || value === undefined) {

    return undefined;
  }
  if (typeof value === 'string') {

    return `"${value}"`;
  }

  if (typeof value === 'bigint') {

    return value.toString();
  }

  if (Array.isArray(value)) {

    return `[${value.map(v => formatQueryValue(v, visited)).filter(v => v !== undefined).join(', ')}]`;
  }

  if (typeof value === 'object') {
    // Check for circular reference
    if (visited.has(value)) {

      return undefined;
    }
    visited.add(value);

    const entries = formatFilterValues(value, v => formatQueryValue(v, visited));
    return `{ ${entries} }`;
  }

  if (typeof value === 'function') {

    return '"[Function]"'; // Handle functions specially
  }

  return String(value);
};

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
    const whereClause = formatFilterValues(options.filters, formatQueryValue);
    Object.entries(options.filters)
      .map(([key, value]) => `${key}: ${formatQueryValue(value)}`)
      .join(', ');

    if (whereClause) {
      queryArgs.push(`where: { ${whereClause} }`);
    }
  }

  return queryArgs;
};

const formatFilterValues = (value: FilterValue, formatter: (v: FilterValue) => string | undefined): string => Object.entries(value)
  .map(([k, v]) => [k, formatter(v)])
  .filter(([, v]) => v !== undefined)
  .map(([k, v]) => `${k}: ${v}`)
  .join(', ');


export { buildBatchQuery, createEntityQueries, createEntityQuery };

