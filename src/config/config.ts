import config from 'config';
import { App, Blockchain, Config, Contract, Database, Entity, SubgraphProvider } from './types';

const getConfig = (): Config => {
    const app = config.get<App>('app');
    const database = config.get<Database>('database');
    const blockchain = config.get<Blockchain>('blockchain');
    const subgraphProviders = config.get<Record<string, SubgraphProvider>>('subgraphProviders');
    const contracts = config.get<Contract[]>('contracts');
    const entities = config.get<Entity[]>('entities');
    return { app, database, blockchain, subgraphProviders, contracts, entities }
}

export { getConfig }
