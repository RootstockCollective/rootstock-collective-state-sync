# Testing Guide

This project uses Node.js's native test runner (available in Node 20+) for testing. No external test framework dependencies are required.

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

This will generate:
- **Terminal output**: Summary of coverage statistics
- **HTML report**: Interactive coverage report in `coverage/index.html`
- **LCOV report**: For integration with CI/CD tools in `coverage/lcov.info`

The coverage tool (`c8`) is configured via `.c8rc.json` to exclude test files and only report on source code.

## Test Structure

Tests are co-located with source files using the `.test.ts` extension. This makes it easy to find and maintain tests alongside the code they're testing.

```
src/
  ├── utils/
  │   ├── toCamelCase.ts
  │   ├── toCamelCase.test.ts
  │   ├── pluralizeEntityName.ts
  │   └── pluralizeEntityName.test.ts
  ├── handlers/
  │   ├── subgraphQueryBuilder.ts
  │   ├── subgraphQueryBuilder.test.ts
  │   ├── dbUpsert.ts
  │   └── dbUpsert.test.ts
  └── ...
```

## Test Coverage

Current test suites include:

### Utility Functions
- **toCamelCase** (`src/utils/toCamelCase.test.ts`)
  - PascalCase to camelCase conversion
  - Edge cases: single characters, empty strings, numbers
  
- **pluralizeEntityName** (`src/utils/pluralizeEntityName.test.ts`)
  - Entity name pluralization with proper English rules
  - Special handling for names ending in 'y'
  - Conversion to camelCase

### Type Guards
- **isColumnType & isArrayColumnType** (`src/handlers/types.test.ts`)
  - Validation of column type strings
  - Array column type validation
  - Type guard edge cases

### Query Builder
- **subgraphQueryBuilder** (`src/handlers/subgraphQueryBuilder.test.ts`)
  - Entity query creation with various options
  - Batch query generation
  - Query filtering, ordering, and pagination
  - Metadata handling

### Database Operations
- **dbUpsert** (`src/handlers/dbUpsert.test.ts`)
  - Record insertion and updates
  - Batch processing
  - Retry logic with exponential backoff
  - Reference field filtering

### Schema Management
- **schema** (`src/context/schema.test.ts`)
  - Schema context creation
  - Entity mapping
  - Composite primary keys
  - Array column types

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { yourFunction } from './yourModule';

describe('YourModule', () => {
  it('should do something', () => {
    const result = yourFunction('input');
    assert.equal(result, 'expected');
  });
});
```

### Using Mocks

Node's native test runner includes a built-in mock system:

```typescript
import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('With Mocks', () => {
  let mockFn;

  beforeEach(() => {
    mockFn = mock.fn(() => 'mocked value');
  });

  it('should use mocked function', () => {
    const result = mockFn();
    assert.equal(result, 'mocked value');
    assert.equal(mockFn.mock.calls.length, 1);
  });
});
```

### Async Tests

```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  assert.ok(result);
});
```

## Best Practices

1. **Co-locate tests**: Keep test files next to the code they test
2. **Use descriptive names**: Test names should clearly describe what they're testing
3. **Test edge cases**: Include tests for boundary conditions and error cases
4. **Keep tests focused**: Each test should verify one specific behavior
5. **Use beforeEach**: Set up test fixtures in beforeEach hooks for consistency
6. **Mock external dependencies**: Use mocks to isolate the code under test

## Continuous Integration

Tests and coverage are automatically run on every push and pull request via GitHub Actions. The workflow:

1. **Runs on multiple Node versions** (20.x, 22.x) to ensure compatibility
2. **Executes linting** to catch code style issues
3. **Runs all tests** to verify functionality
4. **Generates coverage reports** and uploads to Codecov
5. **Comments on PRs** with coverage changes
6. **Verifies build** to ensure the project compiles correctly

### GitHub Actions Workflow

The test workflow is defined in `.github/workflows/test.yml` and includes:

- **Test job**: Runs tests on multiple Node versions with coverage reporting
- **Build job**: Ensures the TypeScript project builds successfully
- **Coverage reporting**: 
  - Uploads to Codecov for historical tracking
  - Adds PR comments showing coverage changes
  - Stores coverage artifacts for 30 days

### Setting Up Codecov

To enable Codecov integration:

1. Sign up at [codecov.io](https://codecov.io/)
2. Connect your GitHub repository
3. Add `CODECOV_TOKEN` to your repository secrets (Settings → Secrets and variables → Actions)
4. Coverage will automatically be reported on each push

The workflow will still run successfully without the token, but coverage won't be uploaded to Codecov.

## Security

The CI/CD pipeline includes multiple security measures:

### Automated Security Scanning

1. **Dependency Review** - Analyzes new dependencies in PRs for vulnerabilities
2. **NPM Audit** - Scans for known vulnerabilities in dependencies
3. **Secret Scanning** - Detects accidentally committed secrets using TruffleHog
4. **SAST Scanning** - Static analysis using CodeQL to find security issues
5. **Dependabot** - Automatically updates dependencies with security patches

### Workflow Security Features

- **Pinned Actions**: All GitHub Actions are pinned to specific commit SHAs
- **Minimal Permissions**: Each job has minimal required permissions
- **No Script Execution**: Dependencies installed with `--ignore-scripts`
- **Credential Isolation**: `persist-credentials: false` to prevent token leakage
- **Build Verification**: Checks for sensitive files in build artifacts

### Best Practices

1. **Review Dependabot PRs**: Check automated dependency updates before merging
2. **Monitor Security Alerts**: GitHub will notify about vulnerabilities
3. **Audit Logs**: Review workflow runs for suspicious activity
4. **Rotate Secrets**: Regularly update repository secrets
5. **Branch Protection**: Enable required status checks and reviews

## Debugging Tests

To debug a specific test file:

```bash
node --inspect --import tsx --test src/path/to/your.test.ts
```

Then attach your debugger to the Node process.

## Test Statistics

- **Total tests**: 57
- **Test suites**: 15
- **All passing**: ✅

## Additional Resources

- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html)
- [Node.js Assertion Module](https://nodejs.org/api/assert.html)

