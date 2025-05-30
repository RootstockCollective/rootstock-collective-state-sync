import { DatabaseSchema } from '../handlers/types';
import { DatabaseContext } from '../context/db';
import { GraphQlContext } from './subgraphProvider';
import { Config } from '../config/config';

export interface AppContext {
    schema: DatabaseSchema;
    dbContext: DatabaseContext;
    graphqlContext: GraphQlContext;
    config: Config;
}