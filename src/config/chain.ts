// chains.ts
import { defineChain } from "viem";
import { rootstock, rootstockTestnet } from "viem/chains";

const rskRegtest = defineChain({
  id: 33,
  name: "RSK Regtest",
  nativeCurrency: { name: "tRBTC", symbol: "tRBTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["http://localhost:4444"],
    },
  },
});

export const CHAINS = {
  mainnet: rootstock,
  testnet: rootstockTestnet,
  regtest: rskRegtest,
} as const

export type SupportedChain = keyof typeof CHAINS;
