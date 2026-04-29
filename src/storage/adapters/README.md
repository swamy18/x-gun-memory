# X-Gun Memory Storage Adapters

X-Gun Memory uses a pluggable storage adapter pattern. Storage is abstracted away, allowing users to bring their own databases while the core retrieval, graph, and embedding logic remains the same.

## How Adapters Work

All adapters must extend `BaseAdapter` and implement the required methods. The system handles embeddings, graph traversal, and retrieval logic on top of the adapter.

## Creating a Custom Adapter

1. Create a new file in this directory (e.g., `my-adapter.js`)
2. Extend `BaseAdapter`:

```javascript
const BaseAdapter = require('./base-adapter');

class MyAdapter extends BaseAdapter {
  constructor(config) {
    super();
    this.config = config;
  }

  async init() {
    // Initialize your storage connection
  }

  async createNode(type, data, embedding) {
    // Store node and return ID
  }

  async getNode(id) {
    // Return node object or null
  }

  async getAllNodesWithEmbeddings() {
    // Return array of nodes with embeddings
  }

  async createEdge(fromId, toId, relationshipType, weight) {
    // Store edge and return ID
  }

  async queryNodes(filters) {
    // Return {nodes: [...], edges: [...]}
  }

  async getConnectedNodes(nodeId, depth) {
    // Return subgraph {nodes: [...], edges: [...]}
  }

  async vectorSearch(queryEmbedding, k) {
    // Return top K similar nodes with distance
  }

  async close() {
    // Clean up connections
  }

  async healthCheck() {
    // Return {status: 'ok', latency: ms}
  }
}

module.exports = MyAdapter;
```

3. Update `AdapterFactory` to include your adapter:

```javascript
const MyAdapter = require('./my-adapter');

// In createAdapter method:
case 'mytype':
  return new MyAdapter(adapterConfigs.mytype);
```

4. Add to `config.json`:

```json
{
  "storage": {
    "type": "mytype",
    "mytype": {
      "connectionString": "..."
    }
  }
}
```

## Adapter Requirements

- **Thread Safety**: Handle concurrent operations safely
- **Vector Search**: Implement efficient similarity search (use native DB features when possible)
- **Data Types**: Preserve JSON data and number[] embeddings
- **Error Handling**: Throw descriptive errors
- **Performance**: Optimize for read-heavy workloads with vector queries

## Built-in Adapters

- **SQLite**: Local file-based with sqlite-vec extension for vector search
- **PostgreSQL**: Scalable with pgvector extension
- **Memory**: In-memory for testing (no persistence)

## Testing Adapters

Run the health check to ensure your adapter works:

```javascript
const adapter = new MyAdapter(config);
await adapter.init();
const health = await adapter.healthCheck();
console.log(health); // {status: 'ok', latency: 5}
```