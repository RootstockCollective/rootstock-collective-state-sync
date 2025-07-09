import { Config, Contract } from './types';

/**
 * Contract name constants to avoid typos and make refactoring easier
 */
export const CONTRACT_NAMES = {
    GOVERNOR: 'Governor',
    BACKERS_MANAGER: 'BackersManager',
    BUILDER_REGISTRY: 'BuilderRegistry',
    REWARD_DISTRIBUTOR: 'RewardDistributor',
} as const;

export type ContractName = typeof CONTRACT_NAMES[keyof typeof CONTRACT_NAMES];

/**
 * Get a contract address by name with type safety
 */
export const getContractAddress = (config: Config, contractName: ContractName): string | undefined => {
    return config.contracts.find(c => c.name === contractName)?.address;
};

/**
 * Get multiple contract addresses by names
 */
export const getContractAddresses = (config: Config, contractNames: ContractName[]): Record<string, string | undefined> => {
    const result: Record<string, string | undefined> = {};
    for (const name of contractNames) {
        result[name] = getContractAddress(config, name);
    }
    return result;
};

/**
 * Validate that required contracts exist in config
 */
export const validateRequiredContracts = (config: Config, requiredContracts: ContractName[]): string[] => {
    const missing: string[] = [];
    for (const contractName of requiredContracts) {
        if (!getContractAddress(config, contractName)) {
            missing.push(contractName);
        }
    }
    return missing;
};
