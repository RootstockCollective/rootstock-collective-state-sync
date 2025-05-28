import { DatabaseSchema } from '../handlers/types';
import { DatabaseContext } from '../context/db';
import { TheGraphContext } from '../context/theGraph';
import { AppConfig } from '../config/config';

export interface AppContext {
    schema: DatabaseSchema;
    dbContext: DatabaseContext;
    graphqlContext: TheGraphContext;
    config: AppConfig;
}