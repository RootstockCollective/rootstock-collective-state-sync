import { Config } from "../config/types";
import { createSchemaContext } from "./schema";
import { createDatabaseContext } from "./db";
import { createTheGraphContext } from "./subgraphProvider";
import { AppContext } from "./types";


const createContexts = (config: Config): AppContext => ({
    schema: createSchemaContext(config.entities),
    dbContext: createDatabaseContext(config.database),
    graphqlContext: createTheGraphContext(config.subgraphProvider),
    config
});

export { createContexts }
