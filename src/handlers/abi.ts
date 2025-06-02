// abis/index.ts
import { BackersManagerAbi } from '../abis/BackersManagerAbi'
import { BuilderRegistryAbi } from '../abis/BuilderRegistryAbi'
import { CycleTimeKeeperAbi } from '../abis/CycleTimeKeeperAbi'
import { GaugeAbi } from '../abis/GaugeAbi'
import { RewardDistributorAbi } from '../abis/RewardDistributorAbi'

export * from '../abis/BackersManagerAbi'
export * from '../abis/BuilderRegistryAbi'
export * from '../abis/CycleTimeKeeperAbi'
export * from '../abis/GaugeAbi'
export * from '../abis/RewardDistributorAbi'

export const abis = {
  BackersManagerAbi,
  BuilderRegistryAbi,
  CycleTimeKeeperAbi,
  GaugeAbi,
  RewardDistributorAbi,
} as const

// 💡 Type derived from keys of the constant
export type CollectiveRewardsAbiName = keyof typeof abis

// 💡 Value is a readonly ABI (inferred as 'readonly ...[]')
export type CollectiveRewardsAbi = typeof abis[CollectiveRewardsAbiName]

export const getAbi = (abiName: CollectiveRewardsAbiName): CollectiveRewardsAbi => abis[abiName]
