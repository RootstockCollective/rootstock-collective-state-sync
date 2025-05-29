import config from 'config';
import { AppConfig, BlockchainConfig, Contract, Entity, Secrets, TheGraph } from './types';


export const getConfig = (): AppConfig => {
    console.log("🚀 ~ getConfig ~ config:", config)
    const blockchain = config.get<BlockchainConfig>('blockchain');
    const thegraph = config.get<TheGraph>('thegraph');
    const contracts = config.get<Contract[]>('contracts');
    const entities = config.get<Entity[]>('entities');
    const secrets = config.get<Secrets>('secrets');
    return { blockchain, thegraph, contracts, entities, secrets };
}; 