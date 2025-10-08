// abis/index.ts
import { BackersManagerAbi } from '../abis/BackersManagerAbi';
import { BuilderRegistryAbi } from '../abis/BuilderRegistryAbi';
import { CycleTimeKeeperAbi } from '../abis/CycleTimeKeeperAbi';
import { GaugeAbi } from '../abis/GaugeAbi';
import { GovernanceAbi } from '../abis/GovernanceAbi';
import { RewardDistributorAbi } from '../abis/RewardDistributorAbi';

export * from '../abis/BackersManagerAbi';
export * from '../abis/BuilderRegistryAbi';
export * from '../abis/CycleTimeKeeperAbi';
export * from '../abis/GaugeAbi';
export * from '../abis/RewardDistributorAbi';

const abis = {
  BackersManagerAbi,
  BuilderRegistryAbi,
  CycleTimeKeeperAbi,
  GaugeAbi,
  GovernanceAbi,
  RewardDistributorAbi,
} as const;

// 💡 Type derived from keys of the constant
type CollectiveRewardsAbiName = keyof typeof abis

// 💡 Value is a readonly ABI (inferred as 'readonly ...[]')
type CollectiveRewardsAbi = typeof abis[CollectiveRewardsAbiName]

const getAbi = (abiName: CollectiveRewardsAbiName): CollectiveRewardsAbi => abis[abiName];

export { getAbi };
export type { CollectiveRewardsAbiName, CollectiveRewardsAbi };
