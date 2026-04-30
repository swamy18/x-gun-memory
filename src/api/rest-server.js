const express = require('express');
const rateLimit = require('express-rate-limit');
const GraphDB = require('../storage/graph-db');
const Embeddings = require('../storage/embeddings');
const GraphTraversal = require('../utils/graph-traversal');
const Retrieval = require('../utils/retrieval');
const Auth = require('../utils/auth');
const Logger = require('../utils/logger');
const MemoryExtractor = require('../utils/memory-extractor');
const config = require('../config-loader');

class RestServer {
  constructor() {
    this.app = express();
    this.graphDB = new GraphDB(config);
    this.embeddings = new Embeddings(config.embeddings.model, config.embeddings.lruCacheSize, true, config);
    this.traversal = null;
    this.retrieval = null;
    this.port = config.api.port;
    this.config = config;
    this.logger = new Logger(config.logging?.file, config.logging?.level);
  }

  async init() {
    await this.embeddings.init();
    this.graphDB.embeddings = this.embeddings;
    await this.graphDB.init();
    this.traversal = new GraphTraversal(this.graphDB);
    this.retrieval = new Retrieval(this.graphDB, this.embeddings, this.config);

    this.app.use(express.json());

    // Rate limiting by agentId
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each agentId to 100 requests per windowMs
      keyGenerator: (req) => req.body.agentId || req.query.agentId || 'anonymous',
      message: 'Too many requests from this agent, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Auth middleware
    this.app.use(Auth.checkApiKey);

    // Rate limiting (after auth)
    this.app.use('/store', limiter);
    this.app.use('/retrieve', limiter);
    this.app.use('/query', limiter);
    this.app.use('/store/batch', limiter);

    this.setupRoutes();
  }

  setupRoutes() {
    // Store structured memory with auto-extraction
    this.app.post('/store/memory', Auth.requirePermission('write'), Auth.validateAgentAccess, async (req, res) => {
      try {
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
        } = req.body;

        if (!content || typeof content !== 'string') {
          return res.status(400).json({ error: 'content is required and must be a string' });
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
        const startTime = Date.now();
        const result = await this.graphDB.createStructuredMemory(content, embedding, agentId, sessionId, namespace, features);

        this.logger.log('info', 'Structured memory stored', {
          agentId,
          sessionId,
          namespace,
          memoryType: features.memory_type,
          tags: features.tags?.length || 0,
          entities: features.entities?.length || 0,
          importance: features.importance,
          autoExtract,
          duration: Date.now() - startTime
        });

        res.json({
          success: true,
          nodeId: result.id,
          features: features
        });
      } catch (error) {
        console.error('Store structured memory error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Store context (legacy endpoint)
    this.app.post('/store', Auth.requirePermission('write'), Auth.validateAgentAccess, async (req, res) => {
      try {
        const { agentId, sessionId, namespace, type, content, relationships = [], metadata = {} } = req.body;

        if (!agentId || typeof agentId !== 'string') {
          return res.status(400).json({ error: 'agentId is required and must be a string' });
        }

        if (!type || typeof type !== 'string' || !content || typeof content !== 'string') {
          return res.status(400).json({ error: 'type and content are required strings' });
        }

        if (!Array.isArray(relationships)) {
          return res.status(400).json({ error: 'relationships must be an array' });
        }

        const embedding = await this.embeddings.generate(content);
        const nodeData = {
          content,
          metadata: {
            ...metadata,
            timestamp: new Date().toISOString(),
          },
        };

        const startTime = Date.now();
        const result = await this.graphDB.createNode(type, nodeData, embedding, agentId, sessionId, namespace);
        const nodeId = result.id;

        // Create relationships only if new node created
        if (result.action === 'create') {
          for (const relatedId of relationships) {
            await this.graphDB.createEdge(nodeId, relatedId, 'references');
          }
        }

        this.logger.log('info', 'Memory stored', {
          agentId,
          sessionId,
          namespace,
          type,
          action: result.action,
          nodeId,
          relatedId: result.relatedId,
          duration: Date.now() - startTime
        });

        res.json({
          success: true,
          nodeId,
          action: result.action,
          relatedId: result.relatedId
        });
      } catch (error) {
        console.error('Store error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Retrieve context
    this.app.get('/retrieve', Auth.validateAgentAccess, async (req, res) => {
      try {
        const { agentId = 'global', sessionId, namespace, q: query, max_nodes = 5, traverse_depth = (this.config.retrieval?.defaultTraverseDepth ?? 2), highAccuracy } = req.query;

        if (!query || typeof query !== 'string') {
          return res.status(400).json({ error: 'query parameter is required and must be a string' });
        }

        const maxNodes = parseInt(max_nodes);
        const traverseDepth = parseInt(traverse_depth);

        if (isNaN(maxNodes) || maxNodes < 1 || maxNodes > 100) {
          return res.status(400).json({ error: 'max_nodes must be a number between 1 and 100' });
        }

        if (isNaN(traverseDepth) || traverseDepth < 0 || traverseDepth > 10) {
          return res.status(400).json({ error: 'traverse_depth must be a number between 0 and 10' });
        }

        const startTime = Date.now();
        const results = await this.retrieval.retrieve(query, {
          maxNodes: maxNodes,
          traverseDepth: traverseDepth,
          agentId: agentId,
          sessionId,
          namespace,
          highAccuracy: highAccuracy === 'true' || highAccuracy === true
        });

        this.logger.log('info', 'Memory retrieved', {
          agentId,
          query,
          maxNodes,
          traverseDepth,
          resultCount: results.length,
          duration: Date.now() - startTime
        });

        res.json({ results });
      } catch (error) {
        console.error('Retrieve error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Query graph
    this.app.post('/query', Auth.validateAgentAccess, async (req, res) => {
      try {
        const { agentId = 'global', node_type, relationship, time_range } = req.body;

        const filters = {};
        if (node_type) filters.type = node_type;
        if (time_range) filters.timeRange = time_range;

        const { nodes, edges: queryEdges } = await this.graphDB.queryNodes(filters, agentId);

        let edges = queryEdges || [];
        if (relationship) {
          // Filter edges by relationship type
          edges = edges.filter(edge => edge.relationship_type === relationship);
        }

        res.json({ nodes, edges });
      } catch (error) {
        console.error('Query error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get graph data
    this.app.get('/graph', async (req, res) => {
      try {
        const { node_id, depth = 2 } = req.query;

        const nodeId = parseInt(node_id);
        const depthNum = parseInt(depth);

        if (isNaN(nodeId) || nodeId < 1) {
          return res.status(400).json({ error: 'node_id must be a positive integer' });
        }

        if (isNaN(depthNum) || depthNum < 0 || depthNum > 10) {
          return res.status(400).json({ error: 'depth must be a number between 0 and 10' });
        }

        const subgraph = await this.traversal.getSubgraph(nodeId, depthNum);

        res.json(subgraph);
      } catch (error) {
        console.error('Graph error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Detailed health check
    this.app.get('/health/detailed', async (req, res) => {
      try {
        const storageHealth = await this.graphDB.healthCheck();
        const embeddingsStats = this.embeddings.getStats();

        res.json({
          status: 'ok',
          storage: storageHealth,
          embeddings: embeddingsStats,
          uptime: process.uptime(),
          version: '2.0.0'
        });
      } catch (error) {
        console.error('Detailed health check error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Batch store
    this.app.post('/store/batch', Auth.requirePermission('write'), Auth.validateAgentAccess, async (req, res) => {
      try {
        const { agentId, sessionId, namespace, items } = req.body;

        if (!agentId || typeof agentId !== 'string') {
          return res.status(400).json({ error: 'agentId is required and must be a string' });
        }

        if (!Array.isArray(items)) {
          return res.status(400).json({ error: 'items must be an array' });
        }

        for (const item of items) {
          if (!item.type || typeof item.type !== 'string' || !item.content || typeof item.content !== 'string') {
            return res.status(400).json({ error: 'each item must have type and content as strings' });
          }
        }

        // Extract texts for batch embedding
        const texts = items.map(item => item.content);
        const embeddings = await this.embeddings.generateBatch(texts);

        const nodeIds = [];

        for (let i = 0; i < items.length; i++) {
          const { type, content, relationships = [], metadata = {} } = items[i];
          const embedding = embeddings[i];

          const nodeData = {
            content,
            metadata: {
              ...metadata,
              timestamp: new Date().toISOString(),
            },
          };

          const result = await this.graphDB.createNode(type, nodeData, embedding, agentId, sessionId, namespace);

          for (const relatedId of relationships) {
            await this.graphDB.createEdge(result.id, relatedId, 'references');
          }

          nodeIds.push(result.id);
        }

        res.json({ success: true, nodeIds });
      } catch (error) {
        console.error('Batch store error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  async start() {
    await this.init();
    this.server = this.app.listen(this.port, () => {
      console.log(`X-Gun Memory REST API server listening on port ${this.port}`);
    });
  }

  async close() {
    if (this.server) {
      this.server.close();
    }
    await this.graphDB.close();
  }
}

// Start the server if run directly
if (require.main === module) {
  const server = new RestServer();
  server.start().catch(console.error);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

module.exports = RestServer;
