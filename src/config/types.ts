import { ColumnType } from "../handlers/types";
import { SupportedChain } from "./chain";

export interface AppConfig {
    blockchain: BlockchainConfig;
    thegraph: TheGraph;
    contracts: Contract[];
    entities: Entity[];
    secrets: Secrets;
}

export interface BlockchainConfig {
    network: SupportedChain;
}
export interface TheGraph {
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
    primaryKeys: string[];
    thegraph: string;
}

export interface Secrets {
    thegraph: {
        apiKey: string;
    };
    database: {
        connectionString: string;
    };
}