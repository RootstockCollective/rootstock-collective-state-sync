# Test Helpers and Configuration

## Overview

This directory contains helpers and utilities for testing the application. Tests are configured to avoid requiring actual external services (database, GraphQL endpoints, blockchain) for unit tests.

## Test Configuration

### Using Test Config

Tests can be run with a test configuration in two ways:

1. **Environment Variable**: Set `NODE_ENV=test` to load `config/test.yml`
   ```bash
   NODE_ENV=test npm test
   ```

2. **Mock Configuration**: Use the `createMockConfig()` helper in test files
   ```typescript
   import { createMockConfig } from '../test-helpers/mockConfig';
   
   const mockConfig = createMockConfig({
     // Override specific values
     blockchain: { network: 'testnet' }
   });
   ```

### Test Types

#### Unit Tests
- Test individual functions in isolation
- Use mock configurations and mock dependencies
- Don't require external services
- Run fast and reliably

#### Integration Tests
- Test interactions between modules
- Require test infrastructure (database, GraphQL endpoints)
- Should be clearly marked and skippable
- Run with: `NODE_ENV=test npm test` (with infrastructure running)

## Mock Helpers

### `createMockConfig(overrides?)`
Creates a complete mock configuration object for testing.

```typescript
const config = createMockConfig({
  blockchain: { network: 'testnet' },
  contracts: [
    { name: 'Governor', address: '0x123' }
  ]
});
```

### `createMockContext()`
Creates a mock AppContext with database, schema, and GraphQL contexts.

```typescript
const context = createMockContext();
// Customize as needed
context.dbContext.db = mockDb;
```

## Running Tests

### All Tests (Unit)
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### With Coverage
```bash
npm run test:coverage
```

### Integration Tests
Require infrastructure setup first:
1. Start PostgreSQL: `docker-compose up -d postgres`
2. Start mock GraphQL server (if available)
3. Run tests: `NODE_ENV=test npm test`

## Writing Tests

### Unit Test Example
```typescript
import { describe, it } from 'node:test';
import { createMockConfig } from '../test-helpers/mockConfig';

describe('MyModule', () => {
  it('should work with mock config', () => {
    const config = createMockConfig();
    // Test logic here
  });
});
```

### Integration Test Example
```typescript
describe('MyModule Integration', () => {
  // Skip if no infrastructure
  const skipIntegration = !process.env.RUN_INTEGRATION_TESTS;
  
  it('should connect to database', { skip: skipIntegration }, async () => {
    // Test requiring real database
  });
});
```

## Best Practices

1. **Prefer Unit Tests**: They're faster and more reliable
2. **Mock External Dependencies**: Use mock configurations and mock objects
3. **Clear Test Names**: Describe what is being tested and expected outcome
4. **Isolate Tests**: Each test should be independent
5. **Mark Integration Tests**: Clearly indicate tests that need infrastructure
6. **Use Test Helpers**: Leverage the mock helpers for consistency