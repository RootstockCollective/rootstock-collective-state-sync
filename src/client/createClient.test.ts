import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { createClient } from './createClient';
import { Config } from '../config/types';
import { createMockConfig } from '../test-helpers/mockConfig';
import { CHAINS } from '../config/chain';

describe('Create Client', () => {
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = createMockConfig({
      blockchain: {
        network: 'mainnet',
        blockIntervalThreshold: 100
      }
    });
  });

  describe('createClient', () => {
    describe('Happy path scenarios', () => {
      it('should create client for mainnet', () => {
        const client = createClient(mockConfig);

        assert.ok(client);
        assert.ok(client.chain);
        assert.ok(client.transport);
        assert.equal(typeof client.getBlockNumber, 'function');
        assert.equal(typeof client.getBlock, 'function');
        assert.equal(typeof client.getTransaction, 'function');
      });

      it('should create client for testnet', () => {
        const testnetConfig: Config = {
          ...mockConfig,
          blockchain: {
            ...mockConfig.blockchain,
            network: 'testnet'
          }
        };

        const client = createClient(testnetConfig);

        assert.ok(client);
        assert.ok(client.chain);
      });

      it('should use correct chain from CHAINS mapping', () => {
        const client = createClient(mockConfig);
        const expectedChain = CHAINS['mainnet'];

        assert.equal(client.chain?.id, expectedChain.id);
        assert.equal(client.chain?.name, expectedChain.name);
      });

      it('should create client with http transport', () => {
        const client = createClient(mockConfig);

        assert.ok(client.transport);
        assert.equal(client.transport.type, 'http');
      });

      it('should create independent clients for multiple calls', () => {
        const client1 = createClient(mockConfig);
        const client2 = createClient(mockConfig);

        assert.notEqual(client1, client2);
      });

      it('should handle all available networks in CHAINS', () => {
        const networks = Object.keys(CHAINS) as (keyof typeof CHAINS)[];

        for (const network of networks) {
          const config: Config = {
            ...mockConfig,
            blockchain: {
              network,
              blockIntervalThreshold: 100
            }
          };

          const client = createClient(config);
          assert.ok(client);
          assert.equal(client.chain?.id, CHAINS[network].id);
        }
      });
    });

    describe('Edge cases and error scenarios', () => {
      it('should throw error for non-existent network', () => {
        const invalidConfig: Config = {
          ...mockConfig,
          blockchain: {
            network: 'nonExistentNetwork' as any,
            blockIntervalThreshold: 100
          }
        };

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });

      it('should throw error for null config', () => {
        assert.throws(() => {
          createClient(null as any);
        });
      });

      it('should throw error for undefined config', () => {
        assert.throws(() => {
          createClient(undefined as any);
        });
      });

      it('should throw error for config without blockchain property', () => {
        const invalidConfig = {
          ...mockConfig,
          blockchain: undefined
        } as any;

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });

      it('should throw error for config with null blockchain', () => {
        const invalidConfig: Config = {
          ...mockConfig,
          blockchain: null as any
        };

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });

      it('should throw error for config with empty network string', () => {
        const invalidConfig: Config = {
          ...mockConfig,
          blockchain: {
            network: '' as any,
            blockIntervalThreshold: 100
          }
        };

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });

      it('should handle config with additional properties', () => {
        const configWithExtra = {
          ...mockConfig,
          extraProp: 'value',
          anotherProp: 123
        };

        const client = createClient(configWithExtra);
        assert.ok(client);
      });

      it('should handle config with numeric network value', () => {
        const invalidConfig: Config = {
          ...mockConfig,
          blockchain: {
            network: 123 as any,
            blockIntervalThreshold: 100
          }
        };

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });

      it('should handle config with array network value', () => {
        const invalidConfig = {
          ...mockConfig,
          blockchain: {
            network: ['mainnet'] as any,
            blockIntervalThreshold: 100
          }
        } as Config;

        assert.throws(() => {
          createClient(invalidConfig);
        }, 'Should throw for array network value');
      });

      it('should handle config with object network value', () => {
        const invalidConfig: Config = {
          ...mockConfig,
          blockchain: {
            network: { name: 'mainnet' } as any,
            blockIntervalThreshold: 100
          }
        };

        assert.throws(() => {
          createClient(invalidConfig);
        });
      });
    });

    describe('Client functionality', () => {
      it('should create a client with expected viem methods', () => {
        const client = createClient(mockConfig);

        // Check for common viem PublicClient methods
        const expectedMethods = [
          'getBlockNumber',
          'getBlock',
          'getTransaction',
          'getTransactionReceipt',
          'getBalance',
          'getCode',
          'call',
          'estimateGas',
          'getLogs',
          'getFilterChanges',
          'watchBlocks',
          'watchBlockNumber'
        ];

        for (const method of expectedMethods) {
          assert.equal(typeof (client as any)[method], 'function', `Missing method: ${method}`);
        }
      });

      it('should have correct chain properties', () => {
        const client = createClient(mockConfig);

        assert.ok(client.chain?.id);
        assert.ok(client.chain?.name);
        assert.ok(client.chain?.rpcUrls);
        assert.ok(client.chain?.nativeCurrency);
      });

      it('should handle missing optional chain properties', () => {
        // Even if chain config is minimal, client should still be created
        const client = createClient(mockConfig);
        assert.ok(client);
      });
    });

    describe('CHAINS configuration validation', () => {
      it('should have valid chain configurations', () => {
        const networks = Object.keys(CHAINS) as (keyof typeof CHAINS)[];

        for (const network of networks) {
          const chain = CHAINS[network];

          assert.ok(chain, `Chain config missing for ${network}`);
          assert.ok(chain.id, `Chain ID missing for ${network}`);
          assert.ok(chain.name, `Chain name missing for ${network}`);
          // network property is optional for custom chains
          assert.ok(chain.nativeCurrency, `Native currency missing for ${network}`);
          assert.ok(chain.rpcUrls, `RPC URLs missing for ${network}`);
        }
      });

      it('should have unique chain IDs', () => {
        const networks = Object.keys(CHAINS) as (keyof typeof CHAINS)[];
        const chainIds = new Set<number>();

        for (const network of networks) {
          const chainId = CHAINS[network].id;
          assert.ok(!chainIds.has(chainId), `Duplicate chain ID ${chainId} for ${network}`);
          chainIds.add(chainId);
        }
      });

      it('should have valid native currency configuration', () => {
        const networks = Object.keys(CHAINS) as (keyof typeof CHAINS)[];

        for (const network of networks) {
          const currency = CHAINS[network].nativeCurrency;

          assert.ok(currency.name, `Currency name missing for ${network}`);
          assert.ok(currency.symbol, `Currency symbol missing for ${network}`);
          assert.equal(typeof currency.decimals, 'number', `Invalid decimals for ${network}`);
          assert.ok(currency.decimals >= 0, `Negative decimals for ${network}`);
        }
      });
    });
  });
});
