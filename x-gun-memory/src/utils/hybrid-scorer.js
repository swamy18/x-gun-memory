class HybridScorer {
  constructor(graphDB, embeddings) {
    this.graphDB = graphDB;
    this.embeddings = embeddings;
  }

  /**
   * Calculate hybrid score combining semantic and graph similarity
   * @param {string} query - Query text
   * @param {Array} candidates - Candidate nodes
   * @param {Object} weights - Weights for different scoring components
   * @returns {Promise<Array>} Scored candidates
   */
  async score(query, candidates, weights = { semantic: 0.7, graph: 0.3 }) {
    const queryEmbedding = await this.embeddings.generate(query);
    const scoredCandidates = [];

    for (const candidate of candidates) {
      // Semantic score
      const semanticScore = this.embeddings.cosineSimilarity(queryEmbedding, candidate.embedding);

      // Graph score (based on connections and relationships)
      const graphScore = await this.calculateGraphScore(candidate.id, query);

      // Combined score
      const hybridScore = (weights.semantic * semanticScore) + (weights.graph * graphScore);

      scoredCandidates.push({
        ...candidate,
        semanticScore,
        graphScore,
        hybridScore
      });
    }

    // Sort by hybrid score
    scoredCandidates.sort((a, b) => b.hybridScore - a.hybridScore);

    return scoredCandidates;
  }

  /**
   * Calculate graph-based relevance score
   * @param {number} nodeId - Node ID
   * @param {string} query - Query text for context
   * @returns {Promise<number>} Graph score (0-1)
   */
  async calculateGraphScore(nodeId, query) {
    try {
      // Get connected nodes
      const connections = await this.graphDB.getConnectedNodes(nodeId, 2);

      if (connections.nodes.length === 0) {
        return 0;
      }

      // Score based on connection strength and relevance
      let totalScore = 0;
      let connectionCount = 0;

      for (const connectedNode of connections.nodes) {
        if (connectedNode.id !== nodeId) {
          // Calculate relevance based on relationship type and content similarity
          const relevance = this.calculateRelationshipRelevance(connectedNode, query);
          totalScore += relevance;
          connectionCount++;
        }
      }

      // Normalize by connection count (more connections = higher score, but diminishing returns)
      const graphScore = connectionCount > 0 ? Math.min(totalScore / Math.sqrt(connectionCount), 1) : 0;

      return graphScore;
    } catch (error) {
      console.warn('Graph scoring error:', error);
      return 0;
    }
  }

  /**
   * Calculate relevance of a connected node
   * @param {Object} node - Connected node
   * @param {string} query - Query text
   * @returns {number} Relevance score (0-1)
   */
  calculateRelationshipRelevance(node, query) {
    // Simple relevance based on relationship type and recency
    const relationshipWeights = {
      'references': 0.8,
      'similar_to': 0.6,
      'follows': 0.4,
      'related': 0.3
    };

    const baseScore = relationshipWeights[node.relationship_type] || 0.2;

    // Boost recent connections
    const ageInHours = (Date.now() - new Date(node.timestamp)) / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, 1 - (ageInHours / 24)); // Decay over 24 hours

    return baseScore * (0.7 + 0.3 * recencyBoost);
  }
}

module.exports = HybridScorer;