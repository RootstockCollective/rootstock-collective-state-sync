import { createPublicClient, http, PublicClient } from 'viem';
import { CHAINS } from '../config/chain';
import { Config } from '../config/types';

const createClient = (config: Config): PublicClient => {
  if (!config?.blockchain?.network) {
    throw new TypeError('Config with blockchain.network is required');
  }

  if (Array.isArray(config?.blockchain?.network)) {
    throw new TypeError('Only single network is supported');
  }

  const chain = CHAINS[config.blockchain.network];
  if (!chain) {
    throw new Error(`Unsupported network: ${config.blockchain.network}`);
  }

  return createPublicClient({
    chain,
    transport: http(), // Optionally customize transport per env
  });
};

export { createClient };
