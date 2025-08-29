import { Config } from '../config/types';
import { DatabaseContext } from './db';
import { DatabaseSchema } from './schema';
import { GraphQlContext } from './subgraphProvider';

interface AppContext {
    schema: DatabaseSchema;
    dbContext: DatabaseContext;
    graphqlContexts: Record<string, GraphQlContext>;
    config: Config;
}

export type { AppContext }
