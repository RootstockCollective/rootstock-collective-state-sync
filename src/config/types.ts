import { ColumnType } from "../handlers/types";
import { SupportedChain } from "./chain";

export interface Config {
    app: App;
    database: Database;
    blockchain: Blockchain;
    subgraphProvider: SubgraphProvider;
    contracts: Contract[];
    entities: Entity[];
    secrets: Secrets;
}

export interface App {
    restartDb: boolean;
}


export interface Database {
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
}

export interface Blockchain {
    network: SupportedChain;
}

export interface SubgraphProvider {
    name: string;
    url: string;
    id: string;
    maxRowsPerRequest: number;
}

export interface Contract {
    name: string;
    address: string;
}

export interface Column {
    name: string;
    type: ColumnType;
    references?: string[];
}

export interface Entity {
    name: string;
    columns: Column[];
    primaryKey: string[];
    thegraph: string;
}

export interface Secrets {
    subgraphProvider: {
        apiKey: string;
    };
    database: {
        connectionString: string;
    };
}
