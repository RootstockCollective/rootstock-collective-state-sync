# Rootstock Collective State Sync

[![Test & Coverage](https://github.com/RootstockCollective/rootstock-collective-state-sync/actions/workflows/test.yml/badge.svg)](https://github.com/RootstockCollective/rootstock-collective-state-sync/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/RootstockCollective/rootstock-collective-state-sync/branch/main/graph/badge.svg)](https://codecov.io/gh/RootstockCollective/rootstock-collective-state-sync)

A state synchronization engine for the [Rootstock Collective](https://www.rootstockcollective.xyz/) dApp. This service continuously monitors smart contracts, retrieves on-chain state, aggregates external data sources, and stores the results in a PostgreSQL database for fast, reliable, and queryable access by client applications.

## 🚀 Features

- **Real-time blockchain monitoring**: Continuously watches for new blocks and contract events
- **Subgraph integration**: Fetches and synchronizes data from The Graph Protocol
- **Database persistence**: Stores all synchronized data in PostgreSQL for efficient querying
- **Configuration-driven**: Flexible configuration system supporting multiple environments
- **Docker support**: Ready-to-use containerization with Docker Compose

### 🚀 Future features
- **Smart contract state synchronization**: Automatically syncs state from Rootstock blockchain

## 📋 Prerequisites

Before running this service, ensure you have:

- **Node.js** v22 or higher
- **PostgreSQL** database (v12 or higher recommended) or **Docker** (if you want to run it in a Docker container)
- **Access to a Rootstock node** (mainnet or testnet or regtest)
- **The Graph API key** (for subgraph queries)

## 🔧 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/rootstock-collective-state-sync.git
cd rootstock-collective-state-sync
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
# Database connection
DATABASE_CONNECTION_STRING=postgresql://username:password@localhost:5432/database_name

# The Graph API key
THE_GRAPH_API_KEY=your_graph_api_key_here

# Optional: Set environment
NODE_ENV=testnet.local
```

### 4. Configure the Service

Choose or create a configuration file in the `./config` directory. Available configurations:

- `testnet.local.yml` - Local development
- `dao.qa.yaml` - DAO QA environment
- `cr.qa.yaml` - CR QA environment
- `release-candidate.yaml` - Release candidate environment
- `mainnet.yaml` - Production mainnet

To use a specific configuration, set the `NODE_ENV` environment variable:

```bash
export NODE_ENV=testnet.local  # or dao.qa, cr.qa, release-candidate, mainnet
```

## 🐳 Docker Setup (Recommended)

### Quick Start with Docker Compose

```bash
# Start PostgreSQL and the application
docker-compose up -d

# View logs
docker-compose logs -f app
```

### Environment Variables for Docker

Create a `.env` file for Docker Compose:

```bash
NODE_ENV=testnet.local
DATABASE_CONNECTION_STRING=postgresql://test:test@postgres:5432/test
THE_GRAPH_API_KEY=your_api_key_here
```

## 🏃‍♂️ Running the Service

### Development Mode

```bash
npm start
```

### Production Mode

```bash
npm run build
npm run start
```

### Available Scripts

- `npm start` - Start the application in development mode
- `npm run build` - Build TypeScript to JavaScript
- `npm run clean` - Remove build artifacts
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

## ⚙️ Configuration

The service uses [node-config](https://github.com/node-config/node-config) for configuration management. Configuration files are located in the `./config` directory.

### Configuration Structure

```yaml
app:
  initializeDb: true          # Whether to initialize database schema
  logLevel: "info"            # Logging level (error, warn, info, debug)
  productionMode: false       # Production mode flag

database:
  batchSize: 10000           # Batch size for database operations
  maxRetries: 3              # Maximum retry attempts
  initialRetryDelay: 1000    # Initial retry delay in milliseconds

subgraphProvider:
  url: "https://gateway.thegraph.com/api"  # The Graph API endpoint
  maxRowsPerRequest: 1000    # Maximum rows per subgraph request

entities:
  # Entity definitions (see Entity Schema section)
```

### Environment Variables

The following environment variables override configuration file settings:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_CONNECTION_STRING` | PostgreSQL connection string | Yes |
| `THE_GRAPH_API_KEY` | The Graph API key | Yes |
| `NODE_ENV` | Environment configuration to use | No |

## 📊 Entity Schema

Each entity in the system mirrors its corresponding Graph entity structure, which requires a mandatory `id` field serving as the primary key. The `id` field can be either a string or bytes type, as per [The Graph's schema requirements](https://thegraph.com/docs/en/subgraphs/developing/creating/ql-schema/#optional-and-required-fields).

This design allows for:
- Consistent entity identification across the system
- Direct mapping between subgraph and database schemas
- Efficient querying and data synchronization

As the system evolves to incorporate additional data sources, the entity structure may be enhanced while maintaining backwards compatibility with existing Graph entities.
 
Each entity is automatically created as a database table with the appropriate schema, indexes, and relationships.

## 🔍 Watchers and Strategies

The service uses a watcher-strategy pattern to monitor blockchain events and sync data:

### Block Watcher

Located in `src/watchers/blockWatcher.ts`, this component:
- Monitors new blocks on the Rootstock network
- Triggers synchronization strategies for each new block

### Strategies

Strategies are located in `src/watchers/strategies/` and define how to:
- Extract data from blockchain events
- Transform data for database storage

**Available Strategies:**
- `blockChangeLogStrategy.ts` - Tracks block changes and entity updates

### Creating Custom Strategies

To create a new strategy:

1. Create a new file in `src/watchers/strategies/`
2. Implement the strategy interface defined in `src/watchers/strategies/types.ts`
3. Register the strategy in the block watcher

## 🧪 Testing

This project uses Node.js's native test runner (Node 20+). No external test frameworks are required.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Coverage reports are generated using `c8` and output to the `coverage/` directory. Tests are co-located with source files using the `.test.ts` extension. See [TESTING.md](./TESTING.md) for detailed testing guidelines.

### CI/CD & Security

Tests and coverage reports are automatically run on every push and pull request via GitHub Actions. The pipeline includes:

- ✅ **Testing** on Node.js v 22.x
- 🔒 **Security scanning** (dependency review, secret detection, SAST)
- 📊 **Coverage reporting** with Codecov integration
- 🤖 **Automated updates** via Dependabot
- 🔐 **Secure workflows** with minimal permissions and pinned actions

All GitHub Actions are pinned to specific commit SHAs for security and reliability.

## 🔧 Development

### Adding New Entities

1. Add the entity definition to the `entities` section in your configuration file
2. Define the entity schema with columns, types, and primary keys
3. The database schema will be automatically created on startup

### Database Schema

The service automatically creates and manages database tables based on entity definitions. Supported column types:

- `Bytes` - Hexadecimal byte strings
- `BigInt` - Large integers
- `String` - Text strings
- `Boolean` - True/false values
- `[Type]` - Arrays of the specified type
- Entity references - Foreign key relationships

### Logging

The service uses [loglevel](https://github.com/pimterry/loglevel) for logging. Set the log level in your configuration:

```yaml
app:
  logLevel: "debug"  # error, warn, info, debug
```

## 🚀 Deployment

### Production Deployment

1. Build the application:
   ```bash
   npm run build
   ```

2. Set production environment variables:
   ```bash
   export NODE_ENV=mainnet
   export DATABASE_CONNECTION_STRING=your_production_db_string
   export THE_GRAPH_API_KEY=your_production_api_key
   ```

3. Start the service:
   ```bash
   node dist/app/main.js
   ```


## 🔗 Related Projects

- [Rootstock Collective](https://www.rootstockcollective.xyz/) - The main dApp
- [The Graph Protocol](https://thegraph.com/) - Decentralized indexing protocol
- [Rootstock](https://rootstock.io/) - Bitcoin-secured smart contract platform

