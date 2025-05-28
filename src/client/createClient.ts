import { createPublicClient, http, PublicClient } from 'viem'
import { CHAINS } from '../config/chain'
import { AppConfig } from '../config/config'

export const createClient = (config: AppConfig): PublicClient => {
  const chain = CHAINS[config.blockchain.network]
  return createPublicClient({
    chain,
    transport: http(), // Optionally customize transport per env
  })
}