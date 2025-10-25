import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { createDatabaseContext, PUBLIC_SCHEMA } from './db';
import { Database } from '../config/types';
import * as fs from 'fs';

describe('Database Context', () => {
  let mockDatabase: Database;

  beforeEach(() => {
    mockDatabase = {
      connectionString: 'postgresql://user:pass@localhost:5432/testdb',
      ssl: false,
      batchSize: 1000,
      maxRetries: 3,
      initialRetryDelay: 100
    };
  });

  describe('PUBLIC_SCHEMA constant', () => {
    it('should export PUBLIC_SCHEMA as "public"', () => {
      assert.equal(PUBLIC_SCHEMA, 'public');
    });

    it('should be a string', () => {
      assert.equal(typeof PUBLIC_SCHEMA, 'string');
    });
  });

  describe('createDatabaseContext', () => {
    it('should create context with basic configuration', () => {
      const context = createDatabaseContext(mockDatabase, 'testschema');

      assert.ok(context.db);
      assert.equal(context.schema, 'testschema');
      assert.equal(context.batchSize, 1000);
      assert.equal(context.maxRetries, 3);
      assert.equal(context.initialRetryDelay, 100);
    });

    it('should use PUBLIC_SCHEMA when specified', () => {
      const context = createDatabaseContext(mockDatabase, PUBLIC_SCHEMA);
      assert.equal(context.schema, 'public');
    });

    it('should handle SSL disabled configuration', () => {
      const context = createDatabaseContext(mockDatabase, 'testschema');

      // Check that knex was configured correctly
      assert.ok(context.db);
      assert.ok(context.db.client);
    });

    it('should handle SSL enabled without cert file', () => {
      const dbWithSsl: Database = {
        ...mockDatabase,
        ssl: true
      };

      const context = createDatabaseContext(dbWithSsl, 'testschema');
      assert.ok(context.db);
    });

    it('should handle SSL enabled with cert file', () => {
      // This test would need to mock fs.existsSync to return true
      // and fs.readFileSync to return cert content
      const dbWithSsl: Database = {
        ...mockDatabase,
        ssl: true
      };

      // Mock fs to simulate cert file exists
      const originalExistsSync = fs.existsSync;
      const originalReadFileSync = fs.readFileSync;

      (fs as any).existsSync = () => true;
      (fs as any).readFileSync = () => 'mock-cert-content';

      const context = createDatabaseContext(dbWithSsl, 'testschema');
      assert.ok(context.db);

      // Restore fs functions
      (fs as any).existsSync = originalExistsSync;
      (fs as any).readFileSync = originalReadFileSync;
    });

    it('should handle empty connection string', () => {
      const dbWithEmptyConn: Database = {
        ...mockDatabase,
        connectionString: ''
      };

      const context = createDatabaseContext(dbWithEmptyConn, 'testschema');
      assert.ok(context.db);
    });

    it('should handle special characters in connection string', () => {
      const dbWithSpecialConn: Database = {
        ...mockDatabase,
        connectionString: 'postgresql://user:p@ss!word@localhost:5432/test-db'
      };

      const context = createDatabaseContext(dbWithSpecialConn, 'testschema');
      assert.ok(context.db);
    });

    it('should handle different schema names', () => {
      const schemas = ['public', 'private', 'test_schema', 'schema-123', ''];

      for (const schema of schemas) {
        const context = createDatabaseContext(mockDatabase, schema);
        assert.equal(context.schema, schema);
      }
    });

    it('should preserve additional database properties', () => {
      const dbWithExtra = {
        ...mockDatabase,
        extraProp: 'value'
      } as any;

      const context = createDatabaseContext(dbWithExtra, 'testschema');
      assert.equal(context.batchSize, 1000);
      assert.equal(context.maxRetries, 3);
    });

    it('should handle zero values for numeric properties', () => {
      const dbWithZeros: Database = {
        ...mockDatabase,
        batchSize: 0,
        maxRetries: 0,
        initialRetryDelay: 0
      };

      const context = createDatabaseContext(dbWithZeros, 'testschema');
      assert.equal(context.batchSize, 0);
      assert.equal(context.maxRetries, 0);
      assert.equal(context.initialRetryDelay, 0);
    });

    it('should handle negative values for numeric properties', () => {
      const dbWithNegatives: Database = {
        ...mockDatabase,
        batchSize: -100,
        maxRetries: -5,
        initialRetryDelay: -50
      };

      const context = createDatabaseContext(dbWithNegatives, 'testschema');
      assert.equal(context.batchSize, -100);
      assert.equal(context.maxRetries, -5);
      assert.equal(context.initialRetryDelay, -50);
    });

    it('should handle very large numeric values', () => {
      const dbWithLarge: Database = {
        ...mockDatabase,
        batchSize: Number.MAX_SAFE_INTEGER,
        maxRetries: Number.MAX_SAFE_INTEGER,
        initialRetryDelay: Number.MAX_SAFE_INTEGER
      };

      const context = createDatabaseContext(dbWithLarge, 'testschema');
      assert.equal(context.batchSize, Number.MAX_SAFE_INTEGER);
      assert.equal(context.maxRetries, Number.MAX_SAFE_INTEGER);
      assert.equal(context.initialRetryDelay, Number.MAX_SAFE_INTEGER);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle null database object', () => {
      assert.throws(() => {
        createDatabaseContext(null as any, 'testschema');
      });
    });

    it('should handle undefined database object', () => {
      assert.throws(() => {
        createDatabaseContext(undefined as any, 'testschema');
      });
    });

    it('should handle null schema name', () => {
      const context = createDatabaseContext(mockDatabase, null as any);
      assert.equal(context.schema, null);
    });

    it('should handle undefined schema name', () => {
      const context = createDatabaseContext(mockDatabase, undefined as any);
      assert.equal(context.schema, undefined);
    });

    it('should handle database without optional properties', () => {
      const minimalDb = {
        connectionString: 'postgresql://localhost/test'
      } as any;

      const context = createDatabaseContext(minimalDb, 'testschema');
      assert.ok(context.db);
      assert.equal(context.schema, 'testschema');
      assert.equal(context.batchSize, undefined);
      assert.equal(context.maxRetries, undefined);
      assert.equal(context.initialRetryDelay, undefined);
    });

    it('should handle malformed connection strings', () => {
      const malformedDbs = [
        { ...mockDatabase, connectionString: 'not-a-url' },
        { ...mockDatabase, connectionString: 'http://wrong-protocol' },
        { ...mockDatabase, connectionString: ':::malformed:::' }
      ];

      for (const db of malformedDbs) {
        // Should not throw, knex will handle validation
        assert.doesNotThrow(() => {
          createDatabaseContext(db, 'testschema');
        });
      }
    });

    it('should handle database with non-string ssl property', () => {
      const dbWithWeirdSsl = {
        ...mockDatabase,
        ssl: 'true' as any  // String instead of boolean
      };

      // Should handle truthy values
      const context = createDatabaseContext(dbWithWeirdSsl, 'testschema');
      assert.ok(context.db);
    });

    it('should create independent contexts for multiple calls', () => {
      const context1 = createDatabaseContext(mockDatabase, 'schema1');
      const context2 = createDatabaseContext(mockDatabase, 'schema2');

      assert.notEqual(context1, context2);
      assert.notEqual(context1.db, context2.db);
      assert.equal(context1.schema, 'schema1');
      assert.equal(context2.schema, 'schema2');
    });

    it('should handle special PostgreSQL schemas', () => {
      const pgSchemas = [
        'pg_catalog',
        'information_schema',
        'pg_temp',
        'pg_toast'
      ];

      for (const schema of pgSchemas) {
        const context = createDatabaseContext(mockDatabase, schema);
        assert.equal(context.schema, schema);
      }
    });
  });

  describe('DatabaseContext type', () => {
    it('should have correct shape', () => {
      const context = createDatabaseContext(mockDatabase, 'testschema');

      assert.ok('db' in context);
      assert.ok('schema' in context);
      assert.ok('batchSize' in context);
      assert.ok('maxRetries' in context);
      assert.ok('initialRetryDelay' in context);
    });

    it('should have correct property types', () => {
      const context = createDatabaseContext(mockDatabase, 'testschema');

      assert.equal(typeof context.db, 'function'); // Knex instance is a function
      assert.equal(typeof context.schema, 'string');
      assert.equal(typeof context.batchSize, 'number');
      assert.equal(typeof context.maxRetries, 'number');
      assert.equal(typeof context.initialRetryDelay, 'number');
    });
  });
});
