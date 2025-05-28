import { AppConfig } from "../config/config";
import { createSchemaContext } from "./schema";
import { createDatabaseContext } from "./db";
import { createTheGraphContext } from "./theGraph";
import { AppContext } from "./types";


export const initializeContexts = (config: AppConfig): AppContext => ({
    schema: createSchemaContext(config.entities),
    dbContext: createDatabaseContext(config.database),
    graphqlContext: createTheGraphContext(config.thegraph[0]),
    config
});