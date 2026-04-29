const AdapterFactory = require('./adapter-factory');
const Deduplication = require('../utils/deduplication');
const GraphTraversal = require('../utils/graph-traversal');
const Retrieval = require('../utils/retrieval');
const RedisClient = require('../utils/redis-client');
const crypto = require('crypto');

class GraphDB {
  constructor(config) {
    this.adapter = AdapterFactory.createAdapter(config.storage);
    this.embeddings = null;
    this.retrieval = null;
    this.traversal = null;
    this.dedup = null;
    this.redis = new RedisClient(config.redis);
    this.config = config;
  }

  async init() {
    await this.adapter.init();
    await this.adapter.runMigrations();
    this.traversal = new GraphTraversal(this);
    this.retrieval = new Retrieval(this, this.embeddings, this.traversal, this.config);
    if (this.config.deduplication?.enabled) {
      this.dedup = new Deduplication(this.embeddings, this.adapter, this.config);
    }
  }

  // Delegate to adapter with deduplication
  async createNode(type, data, embedding, agentId = 'global', sessionId = null, namespace = null) {
    const result = await this.adapter.createNode(type, data, embedding, agentId, sessionId, namespace);
    return { id: result, action: 'create' };
  }

  async createStructuredMemory(content, embedding, agentId = 'global', sessionId = null, namespace = null, features = {}) {
    const result = await this.adapter.createStructuredNode(content, embedding, agentId, sessionId, namespace, features);

    // Invalidate query cache for this agent
    if (this.redis.isEnabled()) {
      try {
        await this.redis.del(`query:${agentId}:*`);
      } catch (error) {
        console.warn('Cache invalidation error:', error.message);
      }
    }

    return { id: result, action: 'create' };
  }
        }

        return { id: result.existingId, action: 'merge', similarity: result.similarity };
      }

      if (result.action === 'update') {
        // Create new node and link to existing
        const newId = await this.adapter.createNode(type, data, embedding, agentId, sessionId, namespace);
        await this.dedup.updateNodeRelation(result.existingId, newId, result.similarity, this.adapter);

        // Invalidate query cache for this agent
        if (this.redis.isEnabled()) {
          try {
            await this.redis.del(`query:${agentId}:*`);
          } catch (error) {
            console.warn('Cache invalidation error:', error.message);
          }
        }

        return { id: newId, action: 'update', relatedId: result.existingId, similarity: result.similarity };
      }
    }

    // Create new node (dedup disabled or action = 'create')
    const id = await this.adapter.createNode(type, data, embedding, agentId, sessionId, namespace);

    // Selective cache invalidation - only for recent queries
    // TTL will handle natural expiration for older cached results
    if (this.redis.isEnabled()) {
      try {
        // Invalidate with SCAN for safety, but limit to avoid blocking
        await this.redis.del(`query:${agentId}:*`);
      } catch (error) {
        console.warn('Cache invalidation error:', error.message);
      }
    }

    return { id, action: 'create' };
  }

  async getNode(id) {
    return await this.adapter.getNode(id);
  }

  async getAllNodesWithEmbeddings() {
    return await this.adapter.getAllNodesWithEmbeddings();
  }

  async createEdge(fromId, toId, relationshipType, weight = 1.0) {
    const result = await this.adapter.createEdge(fromId, toId, relationshipType, weight);

    // Conservative cache invalidation - edges affect graph traversal
    // but most queries are semantic, not graph-based
    if (this.redis.isEnabled()) {
      try {
        // Only clear caches that might be affected by graph changes
        // TTL will handle most cache expiration
        const affectedKeys = await this.redis.keys('query:*:*:*traverse*');
        if (affectedKeys.length > 0) {
          await this.redis.del(...affectedKeys.slice(0, 10)); // Limit to avoid blocking
        }
      } catch (error) {
        console.warn('Cache invalidation error:', error.message);
      }
    }

    return result;
  }

  async queryNodes(filters, agentId = 'global') {
    return await this.adapter.queryNodes(filters, agentId);
  }

  async getConnectedNodes(nodeId, depth) {
    return await this.adapter.getConnectedNodes(nodeId, depth);
  }

  async vectorSearch(queryEmbedding, k) {
    return await this.adapter.vectorSearch(queryEmbedding, k);
  }

  async allQuery(queryEmbedding, limit = 10, agentId = 'global') {
    return await this.adapter.allQuery(queryEmbedding, limit, agentId);
  }

  async query(text, options = {}) {
    const agentId = options.agentId || 'global';
    const hash = crypto.createHash('sha256').update(text + JSON.stringify(options)).digest('hex');
    const cacheKey = `query:${agentId}:${hash}`;

    // Check Redis cache
    if (this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('Query cache read error:', error.message);
      }
    }

    // Compute result
    const embedding = await this.embeddings.generate(text);
    const result = await this.adapter.allQuery(embedding, options.limit || 10, agentId);

    // Cache result with intelligent TTL based on data freshness
    if (this.redis.isEnabled()) {
      try {
        // Use shorter TTL for more dynamic data, longer for stable results
        const ttl = this.calculateCacheTTL(result, options);
        await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttl);
      } catch (error) {
        console.warn('Query cache write error:', error.message);
      }
    }

    return result;
  }

  calculateCacheTTL(result, options) {
    // Base TTL: 1 minute
    let ttl = 60;

    // Shorter TTL for larger result sets (more likely to change)
    if (result.length > 10) {
      ttl = Math.max(30, ttl * 0.5);
    }

    // Shorter TTL for recent time ranges
    if (options.timeRange) {
      const now = Date.now();
      const rangeStart = new Date(options.timeRange.start || 0).getTime();
      const hoursOld = (now - rangeStart) / (1000 * 60 * 60);

      if (hoursOld < 24) {
        ttl = Math.max(15, ttl * 0.3); // Very short TTL for recent data
      }
    }

    return ttl;
  }

  async close() {
    await this.adapter.close();
  }

  async healthCheck() {
    return await this.adapter.healthCheck();
  }

  // Higher-level methods that use retrieval
  async retrieve(query, options = {}) {
    return await this.retrieval.retrieve(query, options);
  }

  async retrieveByType(type, limit = 10) {
    return await this.retrieval.retrieveByType(type, limit);
  }

  async retrieveConnected(nodeId, depth = 2) {
    return await this.retrieval.retrieveConnected(nodeId, depth);
  }

  async retrieveByTime(startTime, endTime, type = null) {
    return await this.retrieval.retrieveByTime(startTime, endTime, type);
  }
}

module.exports = GraphDB;