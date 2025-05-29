import { AppContext } from './types';
import { DatabaseSchema } from '../handlers/types';
import { DatabaseContext } from '../context/db';
import { TheGraphContext } from '../context/theGraph';
import { AppConfig } from '../config/types';

export const createContext = (
    schema: DatabaseSchema,
    dbContext: DatabaseContext,
    graphqlContext: TheGraphContext,
    config: AppConfig
): AppContext => ({
    schema,
    dbContext,
    graphqlContext,
    config
}); 