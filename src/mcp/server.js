const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const express = require('express');
const GraphDB = require('../storage/graph-db');
const Embeddings = require('../storage/embeddings');
const Retrieval = require('../utils/retrieval');
const MemoryExtractor = require('../utils/memory-extractor');
const config = require('../config-loader');

class UniversalGraphServer {
  constructor() {
    this.graphDB = new GraphDB(config);
    this.embeddings = new Embeddings(config.embeddings.model, config.embeddings.lruCacheSize, true, config);
    this.retrieval = null;
  }

  async init() {
    await this.embeddings.init();
    this.graphDB.embeddings = this.embeddings;
    await this.graphDB.init();
    this.retrieval = new Retrieval(this.graphDB, this.embeddings, config);
  }

  async start() {
    await this.init();

    const server = new Server(
      {
        name: 'x-gun-memory',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler('tools/list', async () => {
      return {
        tools: [
          {
            name: 'store_context',
            description: 'Store any data (conversation, file, code, knowledge) in graph',
            inputSchema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', default: 'global' },
                sessionId: { type: 'string' },
                namespace: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['conversation', 'file', 'code', 'context', 'knowledge'],
                },
                content: { type: 'string' },
                relationships: {
                  type: 'array',
                  items: { type: 'number' },
                },
                metadata: { type: 'object' },
              },
              required: ['agentId', 'type', 'content'],
            },
          },
          {
            name: 'retrieve_context',
            description: 'Get relevant context using semantic + graph search',
            inputSchema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', default: 'global' },
                query: { type: 'string' },
                max_nodes: { type: 'number', default: 5 },
                traverse_depth: { type: 'number', default: 2 },
                highAccuracy: { type: 'boolean', default: false },
              },
              required: ['agentId', 'query'],
            },
          },
          {
            name: 'query_graph',
            description: 'Direct graph queries',
            inputSchema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', default: 'global' },
                node_type: { type: 'string' },
                relationship: { type: 'string' },
                time_range: {
                  type: 'object',
                  properties: {
                    start: { type: 'string' },
                    end: { type: 'string' },
                  },
                },
              },
            },
          },
          {
            name: 'batch_store_context',
            description: 'Store multiple memories at once. Much faster than calling store_context repeatedly.',
            inputSchema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', default: 'global' },
                sessionId: { type: 'string' },
                namespace: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['conversation', 'file', 'code', 'context', 'knowledge'] },
                      content: { type: 'string' },
                      metadata: { type: 'object' },
                    },
                    required: ['type', 'content'],
                  },
                },
              },
              required: ['agentId', 'items'],
            },
          },
          {
            name: 'store_memory',
            description: 'Store structured memory with automatic feature extraction',
            inputSchema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', default: 'global' },
                sessionId: { type: 'string' },
                namespace: { type: 'string' },
                content: { type: 'string' },
                memoryType: { type: 'string', enum: ['fact', 'event', 'preference', 'task', 'general'] },
                tags: { type: 'array', items: { type: 'string' } },
                entities: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                autoExtract: { type: 'boolean', default: true }
              },
              required: ['agentId', 'content'],
            },
          },
        ],
      };
    });

    server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'store_context':
            return await this.handleStoreContext(args);
          case 'retrieve_context':
            return await this.handleRetrieveContext(args);
          case 'query_graph':
            return await this.handleQueryGraph(args);
          case 'batch_store_context':
            return await this.handleBatchStoreContext(args);
          case 'store_memory':
            return await this.handleStoreMemory(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });

    const useHttp = process.argv.includes('--http') || process.env.MCP_HTTP === 'true';

    if (useHttp) {
      // HTTP/SSE mode
      const app = express();
      app.use(express.json());

      // Auth middleware for HTTP mode
      if (config.auth?.enabled) {
        app.use((req, res, next) => {
          const apiKey = req.headers['x-api-key'];
          if (!apiKey || !config.auth.apiKeys[apiKey]) {
            return res.status(401).json({ error: 'Valid API key required' });
          }
          req.auth = { permissions: config.auth.apiKeys[apiKey], apiKey };
          next();
        });
      }

      app.get('/health', (req, res) => {
        res.json({ status: "ok", transport: "http-sse", tools: ["store_context", "retrieve_context", "query_graph"] });
      });

      const transport = new SSEServerTransport(app, '/sse', '/messages');
      await server.connect(transport);

      app.listen(config.mcp.port, () => {
        console.error(`X-Gun Memory MCP HTTP/SSE Server started on port ${config.mcp.port}`);
      });
    } else {
      // stdio mode
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('X-Gun Memory MCP Server started (stdio)');
    }
  }

  async handleStoreContext(args) {
    const { agentId, sessionId, namespace, type, content, relationships = [], metadata = {} } = args;

    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    // MCP transports don't currently provide per-request agent identity in this handler,
    // so we cannot reliably enforce agent-based global-write ACLs here.
    // HTTP mode still enforces API key auth at middleware level.

    if (!type || typeof type !== 'string' || !content || typeof content !== 'string') {
      throw new Error('type and content are required strings');
    }

    if (!Array.isArray(relationships)) {
      throw new Error('relationships must be an array');
    }

    // Generate embeddings
    const embedding = await this.embeddings.generate(content);

    // Create node
    const nodeData = {
      content,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    };

    const result = await this.graphDB.createNode(type, nodeData, embedding, agentId, sessionId, namespace);
    const nodeId = result.id;

    // Create relationships only if new node created
    if (result.action === 'create') {
      for (const relatedId of relationships) {
        await this.graphDB.createEdge(nodeId, relatedId, 'references');
      }
    }

    let message;
    if (result.action === 'merge') {
      message = `Memory already exists (ID: ${nodeId}, similarity: ${result.similarity.toFixed(3)}). Updated timestamp and merge count.`;
    } else if (result.action === 'update') {
      message = `Stored as new memory (ID: ${nodeId}). Linked to related memory ID: ${result.relatedId} (similarity: ${result.similarity.toFixed(3)}).`;
    } else {
      message = `Context stored successfully with ID: ${nodeId}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
    };
  }

  async handleRetrieveContext(args) {
    const { agentId, query, max_nodes = 5, traverse_depth = 2, highAccuracy = false } = args;

    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    if (!query || typeof query !== 'string') {
      throw new Error('query is required and must be a string');
    }

    const maxNodes = parseInt(max_nodes);
    const traverseDepth = parseInt(traverse_depth);

    if (isNaN(maxNodes) || maxNodes < 1 || maxNodes > 100) {
      throw new Error('max_nodes must be a number between 1 and 100');
    }

    if (isNaN(traverseDepth) || traverseDepth < 0 || traverseDepth > 10) {
      throw new Error('traverse_depth must be a number between 0 and 10');
    }

    const results = await this.retrieval.retrieve(query, {
      maxNodes: maxNodes,
      traverseDepth: traverseDepth,
      agentId: agentId,
      highAccuracy: highAccuracy
    });

    const content = results.map((result) => ({
      type: 'text',
      text: `Node ${result.id} (${result.type}) [${result.contentType}]: ${result.content} (similarity: ${result.similarity.toFixed(3)})`,
    }));

    return {
      content,
    };
  }

  async handleQueryGraph(args) {
    const { agentId = 'global', node_type, relationship, time_range } = args;

    const filters = {};
    if (node_type) filters.type = node_type;
    if (time_range) filters.timeRange = time_range;

    const { nodes, edges: queryEdges } = await this.graphDB.queryNodes(filters, agentId);

    let edges = queryEdges || [];
    if (relationship) {
      // Filter edges by relationship type
      edges = edges.filter(edge => edge.relationship_type === relationship);
    }

    const content = [
      {
        type: 'text',
        text: `Found ${nodes.length} nodes and ${edges.length} edges`,
      },
    ];

    return {
      content,
    };
  }

  async handleBatchStoreContext(args) {
    const { agentId, sessionId, namespace, items } = args;

    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    if (!Array.isArray(items)) {
      throw new Error('items must be an array');
    }

    for (const item of items) {
      if (!item.type || typeof item.type !== 'string' || !item.content || typeof item.content !== 'string') {
        throw new Error('each item must have type and content as strings');
      }
    }

    // Extract texts for batch embedding
    const texts = items.map(item => item.content);
    const embeddings = await this.embeddings.generateBatch(texts);

    const nodeIds = [];

    for (let i = 0; i < items.length; i++) {
      const { type, content, metadata = {} } = items[i];
      const embedding = embeddings[i];

      const nodeData = {
        content,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      };

      const result = await this.graphDB.createNode(type, nodeData, embedding, agentId, sessionId, namespace);
      nodeIds.push(result.id);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Stored ${items.length} memories. Node IDs: ${nodeIds.join(', ')}`,
        },
      ],
    };
  }

  async handleStoreMemory(args) {
    const {
      agentId,
      sessionId,
      namespace,
      content,
      memoryType,
      tags,
      entities,
      summary,
      importance,
      confidence,
      autoExtract = true
    } = args;

    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    if (!content || typeof content !== 'string') {
      throw new Error('content is required and must be a string');
    }

    // Extract features if not provided and autoExtract is enabled
    let features = {};
    if (autoExtract && config.memory?.autoExtract !== false) {
      features = MemoryExtractor.extractMemoryFeatures(content);
    }

    // Override with provided values
    if (memoryType) features.memory_type = memoryType;
    if (tags) features.tags = tags;
    if (entities) features.entities = entities;
    if (summary) features.summary = summary;
    if (importance !== undefined) features.importance = importance;
    if (confidence !== undefined) features.confidence = confidence;

    // Generate embedding
    const embedding = await this.embeddings.generate(content);

    // Store structured memory
    const result = await this.graphDB.createStructuredMemory(content, embedding, agentId, sessionId, namespace, features);
    const nodeId = result.id;

    const message = `Structured memory stored with ID: ${nodeId} (type: ${features.memory_type}, tags: ${features.tags?.length || 0}, importance: ${features.importance?.toFixed(2) || 'N/A'})`;

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
    };
  }

  async close() {
    await this.graphDB.close();
  }
}

// Start the server if run directly
if (require.main === module) {
  const server = new UniversalGraphServer();
  server.start().catch(console.error);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

module.exports = UniversalGraphServer;
