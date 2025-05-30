import config from 'config';
import { App, Blockchain, Config, Contract, Database, Entity, Secrets, SubgraphProvider } from './types';


export const getConfig = (): Config => {
    const app = config.get<App>('app');
    const database = config.get<Database>('database');
    const blockchain = config.get<Blockchain>('blockchain');
    const subgraphProvider = config.get<SubgraphProvider>('subgraphProvider');
    const contracts = config.get<Contract[]>('contracts');
    const entities = config.get<Entity[]>('entities');
    const secrets = config.get<Secrets>('secrets');
    return { app, database, blockchain, subgraphProvider, contracts, entities, secrets };
}; 

export { Config };
