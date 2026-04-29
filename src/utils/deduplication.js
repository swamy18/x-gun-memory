

class Deduplication {
  /**
   * @param {Object} embeddings - Embeddings instance
   * @param {BaseAdapter} adapter - Storage adapter
   * @param {Object} config - Deduplication config
   */
  constructor(embeddings, adapter, config) {
    this.embeddings = embeddings;
    this.adapter = adapter;
    this.config = config.deduplication || {};
  }

  /**
   * Check for similar content and determine action before storing.
   * @param {string} content - New content to check
   * @param {number[]} embedding - Embedding of the content
   * @param {string} type - Node type
   * @param {string} agentId - Agent scope for isolation
   * @returns {Promise<{action: string, existingId?: number, similarity?: number}>}
   */
  async checkAndHandle(content, embedding, type, agentId = 'global') {
    const similarityThreshold = this.config.similarityThreshold || 0.75;
    const mergeThreshold = this.config.mergeThreshold || 0.95;
    const updateThreshold = this.config.updateThreshold || 0.75;

    // Find similar nodes
    const similarNodes = await this.adapter.findSimilar(embedding, similarityThreshold, 5, agentId);

    // Filter by same type
    const sameTypeNodes = similarNodes.filter(node => node.type === type);

    if (sameTypeNodes.length === 0) {
      return { action: 'create', existingId: null };
    }

    // Sort by similarity descending
    sameTypeNodes.sort((a, b) => b.similarity - a.similarity);
    const topResult = sameTypeNodes[0];

    if (topResult.similarity >= mergeThreshold) {
      // Near duplicate - merge
      return { action: 'merge', existingId: topResult.id, similarity: topResult.similarity };
    } else if (topResult.similarity >= updateThreshold) {
      // Related but different - update and link
      return { action: 'update', existingId: topResult.id, similarity: topResult.similarity };
    } else {
      // Different enough - create new
      return { action: 'create', existingId: null };
    }
  }

  /**
   * Merge new content into existing node.
   * @param {number} existingId - ID of existing node
   * @param {string} newContent - New content to merge
   * @param {Object} newMetadata - New metadata
   * @param {BaseAdapter} adapter - Storage adapter
   * @returns {Promise<number>} Existing node ID
   */
  async mergeNodes(existingId, newContent, newMetadata, adapter) {
    const existingNode = await adapter.getNode(existingId);
    if (!existingNode) {
      throw new Error(`Node ${existingId} not found for merge`);
    }

    const existingContent = existingNode.data.content || '';

    // Save current state to originalVersions before merging
    const originalVersions = existingNode.data.metadata?.originalVersions || [];
    originalVersions.push({
      content: existingContent,
      timestamp: existingNode.data.metadata?.timestamp || existingNode.timestamp,
      mergedAt: new Date().toISOString()
    });

    // Keep max 10 versions
    if (originalVersions.length > 10) {
      originalVersions.shift(); // Remove oldest
    }

    // Check if new content is meaningfully different
    let mergedContent = existingContent;
    if (!existingContent.includes(newContent) && newContent.length > 10) {
      // Append new content if it's not already contained
      mergedContent = existingContent + '\n\n' + newContent;
    }

    // Optimistic locking: check if node hasn't been modified since we read it
    const currentNode = await adapter.getNode(existingId);
    if (!currentNode || currentNode.timestamp !== existingNode.timestamp) {
      throw new Error('Node was modified concurrently, merge aborted');
    }

    // Update metadata
    const updatedMetadata = {
      ...existingNode.data.metadata,
      ...newMetadata,
      lastSeen: new Date().toISOString(),
      mergeCount: (existingNode.data.metadata?.mergeCount || 0) + 1,
      originalVersions: originalVersions
    };

    const updatedData = {
      ...existingNode.data,
      content: mergedContent,
      metadata: updatedMetadata
    };

    // Update node (without changing embedding)
    await adapter.updateNode(existingId, updatedData);

    return existingId;
  }

  /**
   * Create relationship between existing and new similar nodes.
   * @param {number} existingId - ID of existing node
   * @param {number} newNodeId - ID of new node
   * @param {number} similarity - Similarity score
   * @param {BaseAdapter} adapter - Storage adapter
   */
  async updateNodeRelation(existingId, newNodeId, similarity, adapter) {
    await adapter.createEdge(existingId, newNodeId, 'similar_to', similarity);
  }
}

module.exports = Deduplication;
