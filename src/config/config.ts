import config from 'config';
import { ColumnType } from "../handlers/types";
import { SupportedChain } from "./chain";

export interface AppConfig {
    blockchain: BlockchainConfig;
    database: DatabaseConfig;
    thegraph: TheGraph[];
    contracts: Contract[];
    entities: Entity[];
}

export interface BlockchainConfig {
    network: SupportedChain;
}

export interface DatabaseConfig {
    user: string;
    host: string;
    password: string;
    database: string;
    port: number;
}

export interface TheGraph {
    name: string;
    endpoint: string;
    maxRowsPerRequest: number;
}

export interface Contract {
    name: string;
    address: string;
    abis: string[];
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

export const getConfig = (): AppConfig => {
    const blockchain = config.get<BlockchainConfig>('blockchain');
    const database = config.get<DatabaseConfig>('database');
    const thegraph = config.get<TheGraph[]>('thegraph');
    const contracts = config.get<Contract[]>('contracts');
    const entities = config.get<Entity[]>('entities');
    return { blockchain, database, thegraph, contracts, entities };
}; 