import { Config } from "../config/types";
import { createSchemaContext } from "./schema";
import { createDatabaseContext, PUBLIC_SCHEMA } from "./db";
import { createTheGraphContext, GraphQlContext } from "./subgraphProvider";
import { AppContext } from "./types";



const createContexts = (config: Config): AppContext => {
    const graphqlContexts: Record<string, GraphQlContext> = {};
    
    // Create contexts directly from the map
    for (const [name, provider] of Object.entries(config.subgraphProviders)) {
        graphqlContexts[name] = createTheGraphContext(provider);
    }

    return {
        schema: createSchemaContext(config.entities),
        dbContext: createDatabaseContext(config.database, PUBLIC_SCHEMA),
        graphqlContexts,
        config
    };
};

// Pure function to create context with different schema
const createContextWithSchema = (baseContext: AppContext, schemaName: string): AppContext => ({
    ...baseContext,
    dbContext: createDatabaseContext(baseContext.config.database, schemaName)
});

export { createContexts, createContextWithSchema }
