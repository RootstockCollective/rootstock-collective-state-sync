import { Config } from '../config/types';

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
  if (!config?.contracts || typeof contractName !== 'string') {
    return undefined;
  }
  return config.contracts.find(c => c.name === contractName)?.address;
};

