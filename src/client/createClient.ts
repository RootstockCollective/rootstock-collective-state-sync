import { createPublicClient, http, PublicClient } from 'viem'
import { CHAINS } from '../config/chain'
import { Config } from '../config/types'

export const createClient = (config: Config): PublicClient => {
  const chain = CHAINS[config.blockchain.network]
  return createPublicClient({
    chain,
    transport: http(), // Optionally customize transport per env
  })
}