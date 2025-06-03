import { ColumnType } from "../handlers/types";
import { SupportedChain } from "./chain";
import log from "loglevel";

interface Config {
    app: App;
    database: Database;
    blockchain: Blockchain;
    subgraphProvider: SubgraphProvider;
    contracts: Contract[];
    entities: Entity[];
    secrets: Secrets;
}

interface App {
    initializeDb: boolean;
    logLevel: log.LogLevelDesc;
}


interface Database {
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

interface Blockchain {
    network: SupportedChain;
}

interface SubgraphProvider {
    name: string;
    url: string;
    id: string;
    maxRowsPerRequest: number;
}

interface Contract {
    name: string;
    address: string;
}

interface Column {
    name: string;
    type: ColumnType;
}

interface Entity {
    name: string;
    columns: Column[];
    primaryKey: string[];
    thegraph: string;
}

interface Secrets {
    subgraphProvider: {
        apiKey: string;
    }
    database: {
        connectionString: string;
    }
}

export type { Config, App, Database, Blockchain, SubgraphProvider, Contract, Column, Entity, Secrets }
