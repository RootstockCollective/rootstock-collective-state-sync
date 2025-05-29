import { AppConfig } from "../config/types";
import { createSchemaContext } from "./schema";
import { createDatabaseContext } from "./db";
import { createTheGraphContext } from "./theGraph";
import { AppContext } from "./types";


export const initializeContexts = (config: AppConfig): AppContext => ({
    schema: createSchemaContext(config.entities),
    dbContext: createDatabaseContext(config.secrets),
    graphqlContext: createTheGraphContext(config.thegraph, config.secrets),
    config
});