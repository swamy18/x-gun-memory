const BaseAdapter = require('./base-adapter');

class MemoryAdapter extends BaseAdapter {
  constructor(config) {
    super();
    this.nodes = new Map();
    this.edges = new Map();
    this.metadata = new Map();
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
  }

  async init() {
    // No-op for memory adapter
  }

  async createNode(type, data, embedding, agentId = 'global', sessionId = null, namespace = null) {
    const id = this.nextNodeId++;
    const node = {
      id,
      type,
      data,
      embeddings: embedding,
      agent_id: agentId,
      session_id: sessionId,
      namespace: namespace,
      timestamp: new Date().toISOString()
    };
    this.nodes.set(id, node);
    return id;
  }

  async createStructuredNode(content, embedding, agentId = 'global', sessionId = null, namespace = null, features = {}) {
    const id = this.nextNodeId++;
    const node = {
      id,
      type: 'memory',
      data: {
        content,
        ...features
      },
      embeddings: embedding,
      agent_id: agentId,
      session_id: sessionId,
      namespace: namespace,
      memory_type: features.memory_type || 'general',
      tags: features.tags || [],
      entities: features.entities || [],
      summary: features.summary || '',
      importance: features.importance || 0.5,
      confidence: features.confidence || 0.8,
      timestamp: new Date().toISOString()
    };
    this.nodes.set(id, node);
    return id;
  }

  async getNode(id) {
    return this.nodes.get(id) || null;
  }

  async getAllNodesWithEmbeddings() {
    return Array.from(this.nodes.values())
      .filter(node => node.embeddings)
      .map(node => ({
        id: node.id,
        type: node.type,
        data: node.data,
        embedding: node.embeddings
      }));
  }

  async createEdge(fromId, toId, relationshipType, weight = 1.0) {
    const id = this.nextEdgeId++;
    const edge = {
      id,
      from_id: fromId,
      to_id: toId,
      relationship_type: relationshipType,
      weight,
      timestamp: new Date().toISOString()
    };
    this.edges.set(id, edge);
    return id;
  }

  async queryNodes(filters, agentId = 'global') {
    let nodes = Array.from(this.nodes.values())
      .filter(node => node.agent_id === agentId);

    if (filters.type) {
      nodes = nodes.filter(node => node.type === filters.type);
    }

    if (filters.timeRange) {
      if (filters.timeRange.start) {
        nodes = nodes.filter(node => node.timestamp >= filters.timeRange.start);
      }
      if (filters.timeRange.end) {
        nodes = nodes.filter(node => node.timestamp <= filters.timeRange.end);
      }
    }

    if (filters.timeRange) {
      nodes = nodes.filter(node => {
        const nodeTime = new Date(node.timestamp);
        const start = filters.timeRange.start ? new Date(filters.timeRange.start) : null;
        const end = filters.timeRange.end ? new Date(filters.timeRange.end) : null;

        if (start && nodeTime < start) return false;
        if (end && nodeTime > end) return false;
        return true;
      });
    }

    let edges = [];
    if (filters.relationship) {
      edges = Array.from(this.edges.values())
        .filter(edge => edge.relationship_type === filters.relationship);
    }

    return { nodes, edges };
  }

  async getConnectedNodes(nodeId, depth) {
    const visited = new Set();
    const queue = [{ id: nodeId, depth: 0 }];
    const resultNodes = new Map();
    const resultEdges = [];

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();

      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (node) {
        resultNodes.set(id, node);
      }

      // Find connected edges
      const connectedEdges = Array.from(this.edges.values())
        .filter(edge => edge.from_id === id || edge.to_id === id);

      resultEdges.push(...connectedEdges);

      for (const edge of connectedEdges) {
        const neighborId = edge.from_id === id ? edge.to_id : edge.from_id;
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, depth: currentDepth + 1 });
        }
      }
    }

    return { nodes: Array.from(resultNodes.values()), edges: resultEdges };
  }

  async vectorSearch(queryEmbedding, k) {
    const nodesWithEmbeddings = await this.getAllNodesWithEmbeddings();

    const results = nodesWithEmbeddings.map(node => ({
      id: node.id,
      type: node.type,
      data: node.data,
      embedding: node.embedding,
      distance: this.cosineSimilarity(queryEmbedding, node.embedding)
    }));

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, k);
  }

  async findSimilar(embedding, threshold, limit = 5) {
    const nodesWithEmbeddings = await this.getAllNodesWithEmbeddings();

    const results = nodesWithEmbeddings
      .map(node => ({
        id: node.id,
        type: node.type,
        data: node.data,
        similarity: this.cosineSimilarity(embedding, node.embedding)
      }))
      .filter(node => node.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 1;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 1;

    return 1 - (dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)));
  }

  async close() {
    // Clear memory
    this.nodes.clear();
    this.edges.clear();
    this.metadata.clear();
  }

  async updateNode(id, updates) {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Node ${id} not found`);
    }

    if (updates.data !== undefined) {
      node.data = { ...node.data, ...updates.data };
    }

    if (updates.embeddings !== undefined) {
      node.embeddings = updates.embeddings;
    }
  }

  async allQuery(queryEmbedding, limit = 10, agentId = 'global') {
    console.warn("Memory adapter is not for production - using slow JS similarity search");

    return Array.from(this.nodes.values())
      .filter(node => node.embeddings && node.agent_id === agentId) // Filter by agent
      .map(node => ({
        id: node.id,
        type: node.type,
        data: node.data,
        similarity: this.cosineSimilarity(queryEmbedding, node.embeddings)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async fastTextSearch(query, limit = 50, agentId = 'global') {
    // Simple substring search for memory adapter
    const queryLower = query.toLowerCase();

    return Array.from(this.nodes.values())
      .filter(node => node.agent_id === agentId &&
                     node.data.content &&
                     node.data.content.toLowerCase().includes(queryLower))
      .slice(0, limit)
      .map(node => ({
        id: node.id,
        type: node.type,
        data: node.data,
        embedding: node.embeddings,
        agent_id: node.agent_id,
        session_id: node.session_id,
        namespace: node.namespace
      }));
  }

  async getEdges(fromId, toId, relationshipFilter) {
    let edges = Array.from(this.edges.values());

    if (fromId !== null) {
      edges = edges.filter(edge => edge.from_id === fromId);
    }

    if (toId !== null) {
      edges = edges.filter(edge => edge.to_id === toId);
    }

    if (relationshipFilter !== null) {
      edges = edges.filter(edge => edge.relationship_type === relationshipFilter);
    }

    return edges;
  }

  async healthCheck() {
    const start = Date.now();
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 1));
    const latency = Date.now() - start;
    return { status: 'ok', latency };
  }
}

module.exports = MemoryAdapter;