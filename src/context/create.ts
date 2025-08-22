import { Config } from "../config/types";
import { createSchemaContext } from "./schema";
import { createDatabaseContext, PUBLIC_SCHEMA } from "./db";
import { createTheGraphContext } from "./subgraphProvider";
import { AppContext } from "./types";


const createContexts = (config: Config): AppContext => ({
    schema: createSchemaContext(config.entities),
    dbContext: createDatabaseContext(config.database, PUBLIC_SCHEMA),
    graphqlContext: createTheGraphContext(config.subgraphProvider),
    config
});

// Pure function to create context with different schema
const createContextWithSchema = (baseContext: AppContext, schemaName: string): AppContext => ({
    ...baseContext,
    dbContext: createDatabaseContext(baseContext.config.database, schemaName)
});

export { createContexts, createContextWithSchema }
