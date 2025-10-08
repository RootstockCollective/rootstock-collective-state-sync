import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Config } from '../config/types';
import { createMockConfig } from '../test-helpers/mockConfig';
import {
  CONTRACT_NAMES,
  getContractAddress,
} from './contracts';

describe('Contracts Handler', () => {
  const mockConfig: Config = createMockConfig({
    contracts: [
      { name: 'Governor', address: '0x123' },
      { name: 'BackersManager', address: '0x456' },
      { name: 'BuilderRegistry', address: '0x789' }
    ]
  });

  describe('CONTRACT_NAMES', () => {
    it('should export correct contract names', () => {
      assert.equal(CONTRACT_NAMES.GOVERNOR, 'Governor');
      assert.equal(CONTRACT_NAMES.BACKERS_MANAGER, 'BackersManager');
      assert.equal(CONTRACT_NAMES.BUILDER_REGISTRY, 'BuilderRegistry');
      assert.equal(CONTRACT_NAMES.REWARD_DISTRIBUTOR, 'RewardDistributor');
    });
  });

  describe('getContractAddress', () => {
    it('should return correct address for existing contract', () => {
      const address = getContractAddress(mockConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, '0x123');
    });

    it('should return correct address for BackersManager', () => {
      const address = getContractAddress(mockConfig, CONTRACT_NAMES.BACKERS_MANAGER);
      assert.equal(address, '0x456');
    });

    it('should return undefined for non-existent contract', () => {
      const address = getContractAddress(mockConfig, CONTRACT_NAMES.REWARD_DISTRIBUTOR);
      assert.equal(address, undefined);
    });

    it('should handle invalid contract name', () => {
      const address = getContractAddress(mockConfig, 'InvalidContract' as any);
      assert.equal(address, undefined);
    });

    it('should handle empty config contracts', () => {
      const emptyConfig: Config = {
        ...mockConfig,
        contracts: []
      };
      const address = getContractAddress(emptyConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, undefined);
    });

    it('should handle undefined contracts array', () => {
      const invalidConfig = {
        ...mockConfig,
        contracts: undefined
      } as any;
      const address = getContractAddress(invalidConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, undefined);
    });

    it('should handle null contracts array', () => {
      const invalidConfig = {
        ...mockConfig,
        contracts: null
      } as any;
      const address = getContractAddress(invalidConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, undefined);
    });

    it('should return first match when duplicate names exist', () => {
      const duplicateConfig: Config = {
        ...mockConfig,
        contracts: [
          { name: 'Governor', address: '0x111' },
          { name: 'Governor', address: '0x222' }
        ]
      };
      const address = getContractAddress(duplicateConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, '0x111');
    });

    it('should handle contracts with empty addresses', () => {
      const configWithEmptyAddress: Config = {
        ...mockConfig,
        contracts: [
          { name: 'Governor', address: '' }
        ]
      };
      const address = getContractAddress(configWithEmptyAddress, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, '');
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle config with malformed contract objects', () => {
      const malformedConfig = {
        ...mockConfig,
        contracts: [
          { name: 'Governor', address: '0x123' },
          { name: null, address: '0x456' } as any,
          { address: '0x789' } as any
        ]
      };

      const address = getContractAddress(malformedConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, '0x123');
    });

    it('should handle case-sensitive contract names', () => {
      const address = getContractAddress(mockConfig, 'governor' as any);
      assert.equal(address, undefined);
    });

    it('should handle special characters in contract names', () => {
      const specialConfig: Config = {
        ...mockConfig,
        contracts: [
          { name: 'Test-Contract', address: '0xabc' },
          { name: 'Test Contract', address: '0xdef' },
          { name: 'Test.Contract', address: '0x999' }
        ]
      };

      const address1 = getContractAddress(specialConfig, 'Test-Contract' as any);
      const address2 = getContractAddress(specialConfig, 'Test Contract' as any);
      const address3 = getContractAddress(specialConfig, 'Test.Contract' as any);

      assert.equal(address1, '0xabc');
      assert.equal(address2, '0xdef');
      assert.equal(address3, '0x999');
    });

    it('should handle very long contract addresses', () => {
      const longAddressConfig: Config = {
        ...mockConfig,
        contracts: [
          { name: 'Governor', address: '0x' + 'a'.repeat(1000) }
        ]
      };

      const address = getContractAddress(longAddressConfig, CONTRACT_NAMES.GOVERNOR);
      assert.equal(address, '0x' + 'a'.repeat(1000));
    });

    it('should handle numeric contract names', () => {
      const numericConfig: Config = {
        ...mockConfig,
        contracts: [
          { name: '123', address: '0xnum' },
          { name: 456 as any, address: '0xnum2' }
        ]
      };

      const address1 = getContractAddress(numericConfig, '123' as any);
      const address2 = getContractAddress(numericConfig, 456 as any);

      assert.equal(address1, '0xnum');
      assert.equal(address2, undefined); // Number won't match string comparison
    });
  });
});
