/**
 * Abstract base class for storage adapters.
 * All adapters must implement these methods for X-Gun Memory to work.
 */
class BaseAdapter {
  /**
   * Initialize the storage connection.
   * @abstract
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Run database migrations.
   * @abstract
   * @returns {Promise<void>}
   */
  async runMigrations() {
    throw new Error('runMigrations() must be implemented by subclass');
  }

  /**
   * Create a new node in storage.
   * @abstract
   * @param {string} type - Node type (conversation, file, etc.)
   * @param {object} data - Node data (content, metadata)
   * @param {number[]} embedding - Vector embedding array
   * @returns {Promise<number>} Node ID
   */
  async createNode(type, data, embedding, agentId, sessionId, namespace) {
    throw new Error('createNode() must be implemented by subclass');
  }

  async createStructuredNode(content, embedding, agentId, sessionId, namespace, features = {}) {
    throw new Error('createStructuredNode() must be implemented by subclass');
  }

  /**
   * Get a node by ID.
   * @abstract
   * @param {number} id - Node ID
   * @returns {Promise<object|null>} Node object or null
   */
  async getNode(id) {
    throw new Error('getNode() must be implemented by subclass');
  }

  /**
   * Get all nodes that have embeddings.
   * @abstract
   * @returns {Promise<Array<{id: number, type: string, data: object, embedding: number[]}>>}
   */
  async getAllNodesWithEmbeddings() {
    throw new Error('getAllNodesWithEmbeddings() must be implemented by subclass');
  }

  /**
   * Create an edge between nodes.
   * @abstract
   * @param {number} fromId - Source node ID
   * @param {number} toId - Target node ID
   * @param {string} relationshipType - Edge type
   * @param {number} weight - Edge weight
   * @returns {Promise<number>} Edge ID
   */
  async createEdge(fromId, toId, relationshipType, weight = 1.0) {
    throw new Error('createEdge() must be implemented by subclass');
  }

  /**
   * Query nodes with filters.
   * @abstract
   * @param {object} filters - Query filters
   * @returns {Promise<{nodes: object[], edges: object[]}>}
   */
  async queryNodes(filters, agentId) {
    throw new Error('queryNodes() must be implemented by subclass');
  }

  /**
   * Get connected nodes within depth.
   * @abstract
   * @param {number} nodeId - Starting node ID
   * @param {number} depth - Traversal depth
   * @returns {Promise<{nodes: object[], edges: object[]}>}
   */
  async getConnectedNodes(nodeId, depth) {
    throw new Error('getConnectedNodes() must be implemented by subclass');
  }

  /**
   * Perform vector search for similar embeddings.
   * @abstract
   * @param {number[]} queryEmbedding - Query vector
   * @param {number} k - Number of results
   * @returns {Promise<Array<{id: number, type: string, data: object, embedding: number[], distance: number}>>}
   */
  async vectorSearch(queryEmbedding, k) {
    throw new Error('vectorSearch() must be implemented by subclass');
  }

  /**
   * Find nodes similar to the given embedding above a threshold.
   * @abstract
   * @param {number[]} embedding - Query vector
   * @param {number} threshold - Minimum similarity (0-1)
   * @param {number} limit - Maximum results
   * @returns {Promise<Array<{id: number, type: string, data: object, similarity: number}>>}
   */
  async findSimilar(embedding, threshold, limit = 5, agentId = 'global') {
    throw new Error('findSimilar() must be implemented by subclass');
  }

  /**
   * Update an existing node.
   * @abstract
   * @param {number} id - Node ID
   * @param {object} updates - Updated data (data, embeddings, etc.)
   * @returns {Promise<void>}
   */
  async updateNode(id, updates) {
    throw new Error('updateNode() must be implemented by subclass');
  }

  /**
   * Find similar nodes using vector search.
   * @abstract
   * @param {number[]} queryEmbedding - Query embedding vector
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array<{id: number, type: string, data: object, similarity: number}>>}
   */
  async allQuery(queryEmbedding, limit, agentId) {
    throw new Error('allQuery() must be implemented by subclass');
  }

  /**
   * Fast text search using full-text search.
   * @abstract
   * @param {string} query - Text query
   * @param {number} limit - Maximum results to return
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Array>} Candidate nodes
   */
  async fastTextSearch(query, limit, agentId) {
    throw new Error('fastTextSearch() must be implemented by subclass');
  }

  /**
   * Get edges connected to/from nodes.
   * @abstract
   * @param {number|null} fromId - Source node ID (null for any)
   * @param {number|null} toId - Target node ID (null for any)
   * @param {string|null} relationshipFilter - Relationship type filter (null for any)
   * @returns {Promise<Array>} Edge objects
   */
  async getEdges(fromId, toId, relationshipFilter) {
    throw new Error('getEdges() must be implemented by subclass');
  }

  /**
   * Close storage connection.
   * @abstract
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('close() must be implemented by subclass');
  }

  /**
   * Health check.
   * @abstract
   * @returns {Promise<{status: string, latency: number}>}
   */
  async healthCheck() {
    throw new Error('healthCheck() must be implemented by subclass');
  }
}

module.exports = BaseAdapter;
