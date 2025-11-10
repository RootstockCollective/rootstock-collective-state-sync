import { ArrayColumnType, ColumnType } from '../handlers/types';
import { SupportedChain } from './chain';
import log from 'loglevel';

interface Config {
    app: App;
    database: Database;
    blockchain: Blockchain;
    subgraphProviders: Record<string, SubgraphProvider>;
    contracts: Contract[];
    entities: Entity[];
}

interface App {
    initializeDb: boolean;
    logLevel: log.LogLevelDesc;
    productionMode: boolean;
}


interface Database {
    batchSize: number;
    maxRetries: number;
    initialRetryDelay: number;
    connectionString: string;
    ssl: boolean;
}

interface Blockchain {
    network: SupportedChain;
    blockIntervalThreshold: number;
}

interface SubgraphProvider {
    url: string;
    id: string;
    maxRowsPerRequest: number;
    apiKey: string;
}

interface Contract {
    name: string;
    address: string;
}

interface Column {
    name: string;
    type: ColumnType | ArrayColumnType | string;
    nullable?: boolean;
}

interface Entity {
    name: string;
    columns: Column[];
    primaryKey: string[];
    subgraphProvider: string;
}

export type { Config, App, Database, Blockchain, SubgraphProvider, Contract, Column, Entity };
