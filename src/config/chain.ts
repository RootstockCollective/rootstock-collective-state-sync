import { defineChain } from 'viem';
import { rootstock, rootstockTestnet } from 'viem/chains';

const rskRegtest = defineChain({
  id: 33,
  name: 'RSK Regtest',
  nativeCurrency: { name: 'tRBTC', symbol: 'tRBTC', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['http://localhost:4444'],
    },
  },
});

const CHAINS = {
  mainnet: rootstock,
  testnet: rootstockTestnet,
  regtest: rskRegtest,
} as const;

type SupportedChain = keyof typeof CHAINS;

export { CHAINS };
export type { SupportedChain };
