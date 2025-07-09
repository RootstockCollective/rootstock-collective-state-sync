import { Config } from "../config/types";
import { createSchemaContext } from "./schema";
import { createDatabaseContext } from "./db";
import { createSubgraphContext, GraphQlContext } from "./subgraphProvider";
import { AppContext } from "./types";


const createContexts = (config: Config): AppContext => {
    const graphqlContexts: Record<string, GraphQlContext> = {};
    
    for (const provider of config.subgraphProviders) {
        graphqlContexts[provider.name] = createSubgraphContext(provider);
    }

    return {
        schema: createSchemaContext(config.entities),
        dbContext: createDatabaseContext(config.database),
        graphqlContexts,
        config
    };
};

export { createContexts }
