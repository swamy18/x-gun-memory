const AdapterFactory = require('./adapter-factory');
const Deduplication = require('../utils/deduplication');
const RedisClient = require('../utils/redis-client');

class GraphDB {
  constructor(config) {
    this.adapter = AdapterFactory.createAdapter(config.storage);
    this.embeddings = null;
    this.dedup = null;
    this.redis = new RedisClient(config.redis);
    this.config = config;
  }

  async init() {
    await this.adapter.init();
    await this.adapter.runMigrations();
    if (this.config.deduplication?.enabled) {
      this.dedup = new Deduplication(this.embeddings, this.adapter, this.config);
    }
  }

  // Delegate to adapter with deduplication
  async createNode(type, data, embedding, agentId = 'global', sessionId = null, namespace = null) {
    // Check for duplicates if deduplication is enabled
    if (this.dedup) {
      const dedupResult = await this.dedup.checkAndHandle(data.content || '', embedding, type, agentId);

      if (dedupResult.action === 'merge') {
        // Merge with existing node
        const mergedId = await this.dedup.mergeNodes(dedupResult.existingId, data.content || '', data, this.adapter);
        return { id: mergedId, action: 'merge', similarity: dedupResult.similarity };
      } else if (dedupResult.action === 'update') {
        // Create new node and link to existing
        const newId = await this.adapter.createNode(type, data, embedding, agentId, sessionId, namespace);
        await this.dedup.updateNodeRelation(dedupResult.existingId, newId, dedupResult.similarity, this.adapter);

        // Invalidate query cache for this agent
        if (this.redis.isEnabled()) {
          try {
            await this.redis.del(`query:${agentId}:*`);
          } catch (error) {
            console.warn('Cache invalidation error:', error.message);
          }
        }

        return { id: newId, action: 'update', relatedId: dedupResult.existingId, similarity: dedupResult.similarity };
      }
    }

    // Create new node (dedup disabled or action = 'create')
    const id = await this.adapter.createNode(type, data, embedding, agentId, sessionId, namespace);

    // Invalidate query cache for this agent
    if (this.redis.isEnabled()) {
      try {
        await this.redis.del(`query:${agentId}:*`);
      } catch (error) {
        console.warn('Cache invalidation error:', error.message);
      }
    }

    return { id, action: 'create' };
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

  async getEdges(fromId, toId, relationshipFilter) {
    return await this.adapter.getEdges(fromId, toId, relationshipFilter);
  }

  async allQuery(queryEmbedding, limit = 10, agentId = 'global', scope = {}) {
    return await this.adapter.allQuery(queryEmbedding, limit, agentId, scope);
  }

  async close() {
    await this.adapter.close();
  }

  async healthCheck() {
    return await this.adapter.healthCheck();
  }

}

module.exports = GraphDB;
