import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskEndpointApiKey } from './maskEndpointApiKey';

const FAKE_KEY = 'a'.repeat(32);
const SUBGRAPH_ID = 'fake-subgraph-id';

describe('maskEndpointApiKey', () => {
  describe('The Graph Gateway format /api/<KEY>/<id>', () => {
    it('masks the API key for the default gateway URL', () => {
      const masked = maskEndpointApiKey(
        `https://gateway.thegraph.com/api/${FAKE_KEY}/${SUBGRAPH_ID}`
      );
      assert.equal(
        masked,
        `https://gateway.thegraph.com/api/***/${SUBGRAPH_ID}`
      );
    });

    it('preserves the subgraph id after the key', () => {
      const masked = maskEndpointApiKey(
        `https://gateway.thegraph.com/api/${FAKE_KEY}/some-id`
      );
      assert.ok(masked.endsWith('/some-id'));
      assert.ok(!masked.includes(FAKE_KEY));
    });

    it('does not mask if the segment after /api/ is too short to be a key', () => {
      const url = 'https://gateway.thegraph.com/api/v1/health';
      assert.equal(maskEndpointApiKey(url), url);
    });
  });

  describe('Legacy format /<KEY>/<id>', () => {
    it('masks a key at the first path segment', () => {
      const masked = maskEndpointApiKey(
        `https://api.thegraph.com/${FAKE_KEY}/${SUBGRAPH_ID}`
      );
      assert.equal(masked, `https://api.thegraph.com/***/${SUBGRAPH_ID}`);
    });
  });

  describe('Hosted format /subgraphs/name/<id>', () => {
    it('leaves hosted endpoints untouched (no API key in path)', () => {
      const url = 'https://api.thegraph.com/subgraphs/name/rootstock/collective';
      assert.equal(maskEndpointApiKey(url), url);
    });
  });

  describe('Edge cases', () => {
    it('returns [invalid-endpoint] for non-URL input', () => {
      assert.equal(maskEndpointApiKey('not a url'), '[invalid-endpoint]');
    });

    it('returns the URL unchanged when there is no path', () => {
      const url = 'https://gateway.thegraph.com/';
      assert.equal(maskEndpointApiKey(url), url);
    });

    it('does not mask non-alphanumeric long segments', () => {
      const url = `https://gateway.thegraph.com/api/${'-'.repeat(40)}/${SUBGRAPH_ID}`;
      assert.equal(maskEndpointApiKey(url), url);
    });

    it('handles mixed-case keys', () => {
      const mixedKey = 'AbCdEfGhIjKlMnOpQrStUvWxYz123456';
      const masked = maskEndpointApiKey(
        `https://gateway.thegraph.com/api/${mixedKey}/${SUBGRAPH_ID}`
      );
      assert.ok(!masked.includes(mixedKey));
      assert.ok(masked.includes('/api/***/'));
    });
  });
});
