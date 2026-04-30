# X-Gun Memory

Your AI agents forget everything. x-gun-memory fixes that.
Agent-isolated, scalable, vector-powered knowledge sharing.
Your AI agents finally share a brain - safely.

## Compatible AI Tools

Works seamlessly with any MCP-compatible AI system:

- **Claude Desktop** - stdio mode
- **Claude Code** - stdio mode
- **OpenClaw** - HTTP/SSE mode
- **Cursor** - stdio mode
- **Hermes Agent** - stdio mode
- **Any custom AI agent** supporting MCP

Supports both:
- **stdio mode**: single client connections
- **HTTP/SSE mode**: multiple concurrent clients

*See setup instructions below for each platform.*

[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green)](#compatible-ai-tools)
[![Works with Claude](https://img.shields.io/badge/Claude-Supported-blue)](#compatible-ai-tools)
[![Multi-Agent](https://img.shields.io/badge/multi--agent-yes-green)](#multi-agent-usage)
[![Agent Isolation](https://img.shields.io/badge/agent--isolation-yes-blue)](#agent-isolation)
[![Thread Safe](https://img.shields.io/badge/thread--safe-yes-orange)](#concurrency)

[![npm version](https://img.shields.io/npm/v/x-gun-memory)](https://www.npmjs.com/package/x-gun-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Storage](https://img.shields.io/badge/storage-SQLite%20%7C%20Postgres%20%7C%20Memory-orange)](#switching-storage-backends)

## Features

- **Agent Isolation** - Complete memory separation per AI agent. No data leakage between agents.
- **Semi-Structured Memory** - Automatic feature extraction (type, tags, entities, summary, importance)
- **Multi-Agent Support** - Concurrent agents via HTTP-SSE with thread-safe operations
- **Global Knowledge Sharing** - Optional shared memory space (`agentId="global"`) for cross-agent knowledge
- **Pluggable Storage** - SQLite (local), PostgreSQL (cloud), or in-memory. Swap with one config change.
- **Smart Deduplication** - Automatically merges near-duplicate memories (>=0.95), links related ones (0.75-0.95), creates fresh for new content. Maintains version history of original content before each merge.
- **Relevance-based Retrieval** - Full content for high similarity (>=0.85), smart sentence-boundary summary for medium (0.60-0.85), noise filtered below 0.60
- **Fast Embeddings** - LRU cache + batch processing (configurable `embeddings.batchSize`, default `128`) with runtime cached/uncached latency stats
- **Native Vector Search** - O(log N) via sqlite-vec / pgvector. Not brute force.
- **Universal MCP** - Works as stdio (Cursor, Claude Code, Claude Desktop, Hermes) AND HTTP/SSE (Claude.ai, OpenClaw)
- **Batch Operations** - Store multiple memories in one call
- **Token Efficient** - Returns only what's needed, not full node dumps
- **Background Processing** - Asynchronous embedding generation queue
- **Hybrid Scoring** - Combines semantic similarity with graph relationships
- **Database Migrations** - Automatic schema versioning and upgrades
- **Structured Logging** - JSON logging with agent tracking and performance metrics
- **Rate Limiting** - Built-in protection against abuse (100 requests/15min per agent)
- **Conflict Safety** - Optimistic locking prevents concurrent write conflicts

## Architecture

### Storage Layer
- **Nodes**: Store conversations, files, code, context, knowledge with embeddings + agent metadata
  - `agentId`: Agent identifier (required)
  - `sessionId`: Session identifier (optional)
  - `namespace`: Logical grouping (optional)
- **Edges**: Relationships between nodes (references, similar_to, etc.)
- **Embeddings**: Local vector generation with caching
- **Metadata**: Configuration and statistics

### Interfaces
- **MCP Server**: Universal MCP with stdio + HTTP/SSE support
- **REST API**: Endpoints for storage, retrieval, and management

### Project Structure

```text
x-gun-memory/
|-- src/
|   |-- storage/
|   |   |-- adapters/
|   |   |   |-- base-adapter.js      # Abstract adapter interface
|   |   |   |-- sqlite-adapter.js    # SQLite + sqlite-vec
|   |   |   |-- postgres-adapter.js  # PostgreSQL + pgvector
|   |   |   |-- memory-adapter.js    # In-memory (testing)
|   |   |   `-- README.md            # Build your own adapter
|   |   |-- adapter-factory.js       # Auto-select from config
|   |   |-- graph-db.js              # Orchestration layer
|   |   `-- embeddings.js            # Local embeddings + LRU cache
|   |-- mcp/
|   |   `-- server.js                # MCP stdio + HTTP/SSE
|   |-- api/
|   |   `-- rest-server.js           # REST API
|   `-- utils/
|       |-- retrieval.js             # Smart relevance retrieval
|       |-- deduplication.js         # Merge/update/create logic
|       |-- graph-traversal.js       # BFS/DFS traversal
|       `-- logger.js                # Logging
|-- data/
|   `-- x-gun-memory.db              # SQLite database (default fallback)
|-- config.json                      # All configuration
`-- package.json
```

## Installation

```bash
git clone https://github.com/swamy18/x-gun-memory
cd x-gun-memory
npm install
```

Note: `npm install` may report security vulnerabilities. Run `npm audit fix` to attempt automatic fixes, or `npm audit` for details.

### Node Compatibility Note

- `better-sqlite3` may fail to install/load on Windows with Node 24 due to missing prebuilt binaries or build toolchain requirements.
- If SQLite startup fails with missing native bindings, use Node 18/20 LTS, install Visual Studio C++ workload on Windows, or switch to PostgreSQL mode.
- PostgreSQL mode avoids the `better-sqlite3` native dependency path.

## Quick Start

```bash
git clone https://github.com/swamy18/x-gun-memory
cd x-gun-memory
npm install
npm run start:mcp
```

## Running Tests

To run the test suite:

```bash
npm test
```

Note: Currently, no tests are implemented. This is a placeholder command.

## Configuration

Full configuration in `config.json`:

```json
{
  "storage": {
    "type": "sqlite",
    "sqlite": { "path": "./data/x-gun-memory.db" },
    "postgres": {
      "connectionString": "postgresql://user:pass@localhost:5432/xgunmemory"
    }
  },
  "embeddings": {
    "model": "Xenova/all-MiniLM-L6-v2",
    "cacheDir": "./data/embeddings-cache",
    "batchSize": 128,
    "lruCacheSize": 1000
  },
  "retrieval": {
    "defaultMaxNodes": 5,
    "defaultTraverseDepth": 2,
    "highRelevanceThreshold": 0.85,
    "lowRelevanceThreshold": 0.60,
    "summaryLength": 400
  },
  "deduplication": {
    "enabled": true,
    "similarityThreshold": 0.75,
    "mergeThreshold": 0.95,
    "updateThreshold": 0.75
  },
  "mcp": { "port": 3001, "host": "localhost" },
  "api": {
    "port": 3000,
    "host": "localhost",
    "rateLimit": {
      "windowMs": 900000,
      "maxRequests": 100
    }
  },
  "logging": { "level": "info", "file": "./logs/app.log" },
  "agents": {
    "allowGlobalWrites": ["admin-agent"],
    "defaultAgentId": "global"
  },
  "redis": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 6379
  }
}
```

**Switch to Postgres**: Change `storage.type` to `"postgres"`. Zero code changes needed.

**Environment Variables**: Override config values with environment variables.

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your desired values.

Supported variables:
- `STORAGE_TYPE`: Storage backend (`sqlite`, `postgres`, `memory`)
- `POSTGRES_CONNECTION_STRING`: PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_ENABLED`: Redis configuration
- `MCP_PORT`, `API_PORT`, `API_HOST`: Server configuration
- `LOG_LEVEL`: Logging level (`info`, `debug`, etc.)
- `DEFAULT_AGENT_ID`: Default agent identifier
- `AUTH_ENABLED`: Enable/disable authentication

## Usage

### Starting Servers

```bash
# Start MCP server (for Claude, Cursor)
npm run start:mcp

# Start REST API server
npm run start:api

# Start MCP with HTTP/SSE mode
npm run start:mcp:http
```

### Basic Usage Examples

#### Store Memory
```bash
curl -X POST http://localhost:3000/store \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_AGENT_KEY" \
  -d '{
    "agentId": "my-agent",
    "type": "conversation",
    "content": "User asked: What is the weather?"
  }'
```

#### Retrieve Context (Fast Mode)
```bash
curl -H "X-API-Key: YOUR_AGENT_KEY" \
  "http://localhost:3000/retrieve?agentId=my-agent&q=weather&max_nodes=3"
```

#### Retrieve Context (High Accuracy Mode)
```bash
curl -H "X-API-Key: YOUR_AGENT_KEY" \
  "http://localhost:3000/retrieve?agentId=my-agent&q=explain+the+weather+pattern&highAccuracy=true"
```

#### MCP Tool Call
```json
{
  "method": "tools/call",
  "params": {
    "name": "store_context",
    "arguments": {
      "agentId": "claude-desktop",
      "type": "code",
      "content": "Fixed the bug in user authentication"
    }
  }
}
```

### Connect to any platform

#### Cursor / Claude Code / Claude Desktop
In `~/.cursor/mcp.json` or `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "x-gun-memory": {
      "command": "node",
      "args": ["/absolute/path/to/x-gun-memory/src/mcp/server.js"],
      "env": {}
    }
  }
}
```

#### Claude.ai Custom Connector
Start the server in HTTP mode:
```bash
npm run start:mcp:http
```
Then add connector URL: `http://localhost:3001/sse`

#### OpenClaw
In `openclaw.json` or config:
```json
{
  "plugins": {
    "x-gun-memory": {
      "mcp": "http://localhost:3001/sse"
    }
  }
}
```

#### Hermes Agent
In `~/.hermes/config.yaml`:
```yaml
mcp_servers:
  x-gun-memory:
    command: "node"
    args: ["/absolute/path/to/x-gun-memory/src/mcp/server.js"]
```

## Multi-Agent Usage

### Agent Isolation
Each AI agent gets its own memory space. Specify `agentId` in all operations:

```json
{
  "agentId": "claude-assistant",
  "type": "conversation",
  "content": "User asked about weather"
}
```

### Global Knowledge Sharing
Use `agentId: "global"` for shared knowledge:

```json
{
  "agentId": "global",
  "type": "knowledge",
  "content": "Paris is the capital of France"
}
```

All agents can read global memories.
Write controls depend on transport:
- REST API uses API-key permissions (`global`) via auth middleware, or `callerAgentId` / `X-Agent-Id` allowlisted in `agents.allowGlobalWrites`.
- MCP write tools require `callerAgentId` for `agentId: "global"` and validate it against `agents.allowGlobalWrites`.

### Session & Namespace
Optional grouping for better organization:

```json
{
  "agentId": "my-chatbot",
  "sessionId": "session-123",
  "namespace": "customer-support",
  "type": "conversation",
  "content": "How can I help you today?"
}
```

### Concurrent Access
- HTTP-SSE mode supports multiple concurrent agents
- Thread-safe operations with write locking
- Rate limiting per agent prevents abuse

## API Reference

### MCP Tools

#### store_context
Store any data in the graph.

Parameters: `{agentId, callerAgentId?, sessionId?, namespace?, type, content, relationships?, metadata?}`  
Required: `agentId`, `type`, `content`

Returns:
- "Context stored successfully with ID: Z" (new)
- "Memory already exists (ID: X, similarity: 0.97). Updated." (merge)
- "Stored as new memory (ID: Y). Linked to related ID: X (similarity: 0.82)." (update)

#### retrieve_context
Get relevant context using semantic + graph search.

Parameters: `{agentId, sessionId?, namespace?, query, max_nodes?, traverse_depth?, highAccuracy?}`  
Required: `agentId`, `query`

Returns: `[{id, type, content, contentType: "full"|"summary", similarity, source}]`

#### query_graph
Direct graph queries with filters.

Parameters: `{agentId, node_type?, relationship?, time_range?: {start?, end?}}`

Returns: `{nodes, edges}`

#### batch_store_context
Store multiple memories at once. Much faster than calling store_context repeatedly.

Parameters: `{agentId, callerAgentId?, sessionId?, namespace?, items: [{type, content, metadata?}]}`  
Required: `agentId`, `items`

Returns: "Stored X memories. Node IDs: ..."

#### store_memory
Store structured memory with automatic feature extraction.

Parameters: `{agentId, callerAgentId?, sessionId?, namespace?, content, memoryType?, tags?, entities?, summary?, importance?, confidence?, autoExtract?}`  
Required: `agentId`, `content`

Returns: Structured memory with extracted features

### REST Endpoints

All endpoints require `agentId` in request body/query parameters.

- `POST /store/memory` - Store structured memory with auto-extraction
  - Body: `{agentId, callerAgentId?, content, memoryType?, tags?, entities?, summary?, importance?, confidence?, autoExtract?}`
- `POST /store` - Store single memory (with dedup)
  - Body: `{agentId, callerAgentId?, sessionId?, namespace?, type, content, relationships?, metadata?}`
- `POST /store/batch` - Store multiple memories at once
  - Body: `{agentId, callerAgentId?, sessionId?, namespace?, items: [{type, content, metadata?}]}`
- `GET /retrieve?agentId=X&sessionId=Y&namespace=Z&q=query&max_nodes=5&traverse_depth=2&highAccuracy=false` - Semantic + graph search (optional session/namespace scope)
- `POST /query` - Filter by type/relationship/time
  - Body: `{agentId, node_type?, relationship?, time_range?}`
- `GET /graph?node_id=123&depth=2` - Traverse from node ID (within agent scope)
- `GET /health` - Basic health check
- `GET /health/detailed` - Storage + embeddings stats

#### GET /health/detailed Response
```json
{
  "status": "ok",
  "storage": { "type": "sqlite", "status": "ok", "latencyMs": 2 },
  "embeddings": {
    "cacheHits": 142,
    "cacheMisses": 23,
    "lruCacheSize": 321,
    "redisEnabled": true,
    "avgLatencyMs": 45,
    "avgCachedLatencyMs": 8,
    "avgUncachedLatencyMs": 220,
    "batchSize": 128
  },
  "uptime": 3600,
  "version": "1.0.0"
}
```


## Switching Storage Backends

### Local Development (SQLite - default)
No changes needed. Works out of the box.

### Production (PostgreSQL)
1. Install pgvector: `CREATE EXTENSION vector;`
2. Ensure planner stats are current so vector/text indexes are used efficiently: `ANALYZE nodes; ANALYZE edges;`
3. Update config.json:
   ```json
   {
     "storage": {
       "type": "postgres",
       "postgres": {
         "connectionString": "your connection string"
       }
     }
   }
   ```
3. Restart server. Done.

### Testing / Ephemeral
```json
{
  "storage": {
    "type": "memory"
  }
}
```
Data lost on restart. No dependencies needed.

### Build Your Own Adapter
See `src/storage/adapters/README.md`

## Security

- All data stored locally
- No external API calls for core functionality
- SQLite database file permissions apply
- Embeddings cached locally
- Agent isolation prevents data leakage
- Rate limiting protects against abuse

## Concurrency

- **Thread Safety**: Write operations serialized with mutexes (SQLite) or connection pooling (PostgreSQL)
- **Optimistic Locking**: Prevents conflicts in deduplication merges
- **Agent-Level Rate Limiting**: 100 requests per 15 minutes per agent
- **Concurrent Reads**: Multiple agents can read simultaneously
- **Conflict Resolution**: Automatic retry logic for transient failures

## Advanced Features

### Redis Integration
- **Durable Queue**: Redis-backed embedding processing with at-least-once delivery (RPOPLPUSH pattern)
- **Distributed Cache**: Multi-level caching (Redis + LRU) with stampede protection
- **Job Deduplication**: Redis sets prevent duplicate embedding jobs
- **Safe Pattern Deletion**: SCAN-based cache invalidation (non-blocking)
- **TTL Strategy**: Intelligent cache expiration based on data freshness
- **High Availability**: System works without Redis (graceful degradation)

### Background Embedding Processing
Embeddings are processed asynchronously to prevent blocking:

```js
// Automatic queue processing
await embeddings.generateBatch(texts); // Non-blocking
```

### Hybrid Retrieval (Fast + Accurate)
Two-stage retrieval for optimal performance:

1. **Fast Keyword Filtering**: Full-text search (FTS5/PostgreSQL tsvector)
2. **Embedding Reranking**: Semantic similarity on filtered candidates

```json
{
  "retrieval": {
    "useHybrid": true,
    "fastLimit": 50,
    "finalLimit": 10
  }
}
```

**Performance**: 5-10x faster than pure vector search, same or better accuracy.

### Dual Mode Retrieval (Fast vs High Accuracy)

**Automatic Mode Selection:**
- **Fast Mode** (default): Summary + light context for quick responses
- **High Accuracy Mode**: Full content + graph expansion for complex queries

**Auto-Detection Triggers:**
- Explicit `highAccuracy: true` flag
- Query length > 80 characters
- Keywords: "why", "explain", "analyze", "compare", "reason", "how"

**Configuration:**
```json
{
  "retrieval": {
    "dualMode": true,
    "highAccuracyLimit": 100,
    "graphDepth": 2
  }
}
```

`dualMode: false` forces fast mode unless the request explicitly sets `highAccuracy: true`.

**Performance Comparison:**
- **Fast Mode**: 50-100ms, summary content
- **High Accuracy Mode**: 200-500ms, full content + context

Embedding throughput note (local benchmark example):
- On this project setup, `embeddings.batchSize=128` outperformed `64` for a 256-item uncached run (`3389ms` vs `3851ms` total).
- Prefer `POST /store/batch` over repeated `POST /store` for higher write throughput.

### Hybrid Scoring
Combines semantic similarity with graph relationships:

```json
{
  "retrieval": {
    "useHybridScoring": true,
    "hybridWeights": {
      "semantic": 0.7,
      "graph": 0.3
    }
  }
}
```

## Semi-Structured Memory

Store memories with automatic feature extraction and lightweight structure:

### Memory Features
- **Type**: `fact`, `event`, `preference`, `task`, `general`
- **Tags**: Up to 5 relevant keywords (auto-extracted)
- **Entities**: People, places, organizations (auto-extracted)
- **Summary**: One-line summary (first sentence)
- **Importance**: 0-1 score based on keywords and urgency
- **Confidence**: 0-1 extraction confidence score

### API Usage

```bash
# Store structured memory with auto-extraction
curl -X POST http://localhost:3000/store/memory \
  -H "X-API-Key: YOUR_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "content": "I need to finish the project report by Friday. This is urgent!"
  }'
```

**Response:**
```json
{
  "success": true,
  "nodeId": 123,
  "features": {
    "memory_type": "task",
    "tags": ["urgent", "project", "deadline"],
    "entities": [],
    "summary": "I need to finish the project report by Friday.",
    "importance": 0.8,
    "confidence": 0.8
  }
}
```

### MCP Tool

```json
{
  "method": "tools/call",
  "params": {
    "name": "store_memory",
    "arguments": {
      "agentId": "claude-assistant",
      "content": "Paris is the capital of France",
      "memoryType": "fact",
      "importance": 0.9
    }
  }
}
```

### Configuration

```json
{
  "memory": {
    "autoExtract": true,
    "maxTags": 5,
    "maxEntities": 5
  }
}
```

## Production Considerations

## Minimal Configurations

### In-memory (fast local testing)
```json
{
  "storage": { "type": "memory" },
  "auth": { "enabled": false },
  "redis": { "enabled": false }
}
```

### SQLite (single-node persistence)
```json
{
  "storage": {
    "type": "sqlite",
    "sqlite": { "path": "./data/x-gun-memory.db" }
  },
  "auth": { "enabled": true },
  "redis": { "enabled": false }
}
```

### PostgreSQL (production baseline)
```json
{
  "storage": {
    "type": "postgres",
    "postgres": { "connectionString": "postgresql://user:pass@host:5432/db" }
  },
  "auth": { "enabled": true },
  "redis": { "enabled": true, "host": "127.0.0.1", "port": 6379 }
}
```

## Troubleshooting

- `Invalid API key` or `Permission 'write' required`: check `auth.enabled`, `X-API-Key`, and key permissions in `config.json`.
- `Global access not permitted`: your key needs `"global"` permission for REST global writes.
- `SQLite adapter failed to load`: install `better-sqlite3` and ensure native build support.
- `PostgreSQL adapter failed to load`: install `pg` and verify connection string.
- `Redis disabled: ioredis module not available`: install `ioredis` or set `"redis": { "enabled": false }`.
- Slow first request: embedding model initialization is cold-start heavy on first run.
- MCP HTTP connector issues: confirm server started with `npm run start:mcp:http` and use `/sse` endpoint.

## Notes on Performance Claims

Latency and throughput numbers in this README are environment-dependent and vary by model, hardware, storage backend, and network conditions. Use your own workload benchmarks for production sizing.

### Redis Best Practices
- **Connection Pooling**: Redis handles connection pooling automatically
- **Memory Management**: Monitor Redis memory usage with `INFO memory`
- **Persistence**: Configure Redis AOF/RDB for data durability
- **Monitoring**: Use Redis `INFO` command and keyspace notifications

### Cache Strategy
- **TTL-Based Expiration**: Reduces need for manual invalidation
- **Stampede Protection**: Prevents thundering herd on cache misses
- **Hierarchical Caching**: LRU + Redis for optimal performance

### Queue Reliability
- **At-Least-Once Delivery**: RPOPLPUSH ensures jobs aren't lost
- **Deduplication**: Redis sets prevent duplicate job processing
- **Monitoring**: Track queue lengths and processing times

### Scaling Considerations
- **Read Replicas**: Use Redis replication for read-heavy workloads
- **Sharding**: Consider Redis Cluster for massive scale
- **Backup**: Regular Redis backups for disaster recovery

### Database Migrations
Automatic schema upgrades with version tracking:

```sql
-- Automatically applied on startup
ALTER TABLE nodes ADD COLUMN agent_id TEXT;
CREATE INDEX idx_nodes_agent_id ON nodes(agent_id);
```

### Authentication & Security
API key-based authentication with granular permissions:

```json
{
  "auth": {
    "apiKeys": {
      "agent-key": ["read", "write", "global"]
    }
  }
}
```

### Structured Logging
JSON logging for monitoring and debugging:

```json
{
  "timestamp": "2026-04-29T18:30:50.000Z",
  "level": "INFO",
  "message": "Memory stored",
  "agentId": "claude-assistant",
  "action": "store",
  "duration": 45
}
```

## License

MIT
