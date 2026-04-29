const HybridScorer = require('./hybrid-scorer');

class Retrieval {
  constructor(graphDB, embeddings, traversal, config) {
    this.graphDB = graphDB;
    this.embeddings = embeddings;
    this.traversal = traversal;
    this.config = config.retrieval || {};
    this.hybridScorer = new HybridScorer(graphDB, embeddings);
  }

  // Helper to find sentence boundary
  findSentenceBoundary(text, maxLength) {
    if (text.length <= maxLength) return text.length;

    // Look for sentence endings within maxLength
    const searchText = text.slice(0, maxLength);
    const sentenceEndings = ['. ', '.\n', '! ', '!\n', '? ', '?\n'];

    for (let i = searchText.length - 1; i >= 0; i--) {
      for (const ending of sentenceEndings) {
        if (searchText.slice(i - ending.length + 1, i + 1) === ending) {
          return i + 1;
        }
      }
    }

    // No sentence boundary found, return maxLength
    return maxLength;
  }

  // Process content based on relevance
  processContent(content, similarity, config) {
    if (!content) return { content: '', contentType: 'skipped' };

    const highThreshold = config.highRelevanceThreshold || 0.85;
    const lowThreshold = config.lowRelevanceThreshold || 0.60;
    const summaryLength = config.summaryLength || 400;

    if (similarity >= highThreshold) {
      return { content: content, contentType: 'full' };
    } else if (similarity >= lowThreshold) {
      const boundary = this.findSentenceBoundary(content, summaryLength);
      const summary = content.slice(0, boundary) + (boundary < content.length ? '...' : '');
      return { content: summary, contentType: 'summary' };
    } else {
      return { content: '', contentType: 'skipped' };
    }
  }

  shouldUseHighAccuracy(query, options) {
    // Explicit flag takes precedence
    if (options.highAccuracy !== undefined) {
      return options.highAccuracy;
    }

    if (!query) return false;

    const lowerQuery = query.toLowerCase();

    // Length-based trigger (longer queries likely need deeper reasoning)
    if (query.length > 80) return true;

    // Keyword triggers for complex reasoning
    const triggers = ["why", "explain", "analyze", "compare", "reason", "how", "what if", "pros and cons"];
    return triggers.some(trigger => lowerQuery.includes(trigger));
  }

  async retrieve(query, options = {}) {
    const maxNodes = options.maxNodes || this.config.defaultMaxNodes || 5;
    const traverseDepth = options.traverseDepth || this.config.defaultTraverseDepth || 2;
    const agentId = options.agentId || 'global';
    const useHybridScoring = options.useHybridScoring || this.config.useHybridScoring || false;
    const useHybrid = options.useHybrid || this.config.useHybrid || true;
    const fastLimit = this.config.fastLimit || 50;

    const isHighAccuracy = this.shouldUseHighAccuracy(query, options);

    const startTime = Date.now();

    let results;
    if (isHighAccuracy) {
      results = await this.highAccuracyRetrieval(query, agentId, options);
    } else {
      results = await this.fastRetrieval(query, agentId, options);
    }

    const totalTime = Date.now() - startTime;

    console.log(`Retrieval: mode=${isHighAccuracy ? 'highAccuracy' : 'fast'}, time=${totalTime}ms, results=${results.length}`);

    return results;

    let candidates = [];
    let fastFilterTime = 0;
    let embeddingTime = 0;

    if (useHybrid) {
      // STEP 1: Fast keyword/text search
      const fastStart = Date.now();
      candidates = await this.graphDB.adapter.fastTextSearch(query, fastLimit, agentId);
      fastFilterTime = Date.now() - fastStart;

      // Log fast filter results
      console.log(`Fast filter: ${candidates.length} candidates in ${fastFilterTime}ms`);

      // If no keyword results, fallback to full vector search
      if (candidates.length === 0) {
        console.log('No keyword results, falling back to vector search');
        const embeddingStart = Date.now();
        const queryEmbedding = await this.embeddings.generate(query);
        embeddingTime = Date.now() - embeddingStart;

        const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes * 2, agentId);
        candidates = semanticResults.map(result => ({
          ...result,
          data: result.data,
          embedding: result.embedding
        }));
      }
    } else {
      // Original vector-only approach
      const embeddingStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      embeddingTime = Date.now() - embeddingStart;

      const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes * 2, agentId);
      candidates = semanticResults.map(result => ({
        ...result,
        data: result.data,
        embedding: result.embedding
      }));
    }

    return this.fastRetrievalLogic(query, candidates, maxNodes, fastFilterTime, embeddingTime, useHybrid);

    // Convert distance to similarity (cosine distance: 0=similar, 2=dissimilar)
    let processedResults = semanticResults.map(result => ({
      ...result,
      similarity: 1 - result.distance // Convert distance to similarity
    }));

    // Apply hybrid scoring if enabled
    if (useHybridScoring) {
      processedResults = await this.hybridScorer.score(query, processedResults);
      // Update similarity to hybrid score
      processedResults = processedResults.map(result => ({
        ...result,
        similarity: result.hybridScore || result.similarity
      }));
    }

    // For top semantic results, expand via graph traversal
    const expandedResults = new Map();

    for (const result of processedResults) {
      // Add the semantic result
      if (!expandedResults.has(result.id)) {
        const { content, contentType } = this.processContent(result.data.content, result.similarity, this.config);
        if (contentType !== 'skipped') {
          expandedResults.set(result.id, {
            id: result.id,
            type: result.type,
            content: content,
            contentType: contentType,
            similarity: result.similarity,
            source: 'semantic'
          });
        }
      }

      // Traverse graph from this node
      const subgraph = await this.graphDB.getConnectedNodes(result.id, traverseDepth);
      for (const traversedNode of subgraph.nodes) {
        if (!expandedResults.has(traversedNode.id)) {
          // For traversed nodes, compute similarity
          let similarity = 0;
          if (traversedNode.embedding) {
            similarity = this.embeddings.cosineSimilarity(queryEmbedding, traversedNode.embedding);
          }

          const { content, contentType } = this.processContent(traversedNode.data.content, similarity, this.config);
          if (contentType !== 'skipped') {
            expandedResults.set(traversedNode.id, {
              id: traversedNode.id,
              type: traversedNode.type,
              content: content,
              contentType: contentType,
              similarity: similarity,
              source: 'graph'
            });
          }
        }
      }
    }

    // Sort by similarity, filter out skipped, return top results
    const results = Array.from(expandedResults.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxNodes);

    return results;
  }

  async fastRetrieval(query, agentId, options = {}) {
    const maxNodes = options.maxNodes || this.config.defaultMaxNodes || 5;
    const fastLimit = this.config.fastLimit || 50;

    // STEP 1: Fast keyword/text search
    const fastStart = Date.now();
    let candidates = await this.graphDB.adapter.fastTextSearch(query, fastLimit, agentId);
    const fastFilterTime = Date.now() - fastStart;

    // If no keyword results, fallback to full vector search
    let embeddingTime = 0;
    if (candidates.length === 0) {
      const embeddingStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      embeddingTime = Date.now() - embeddingStart;

      const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes * 2, agentId);
      candidates = semanticResults.map(result => ({
        ...result,
        data: result.data,
        embedding: result.embedding
      }));
    }

    return this.fastRetrievalLogic(query, candidates, maxNodes, fastFilterTime, embeddingTime, true);
  }

  async fastRetrievalLogic(query, candidates, maxNodes, fastFilterTime, embeddingTime, useHybrid) {
    // STEP 2: Embedding-based reranking (if we have candidates with embeddings)
    const candidatesWithEmbeddings = candidates.filter(c => c.embedding);

    if (candidatesWithEmbeddings.length > 0) {
      const rerankStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      const rerankTime = Date.now() - rerankStart;

      // Rerank by semantic similarity
      const reranked = candidatesWithEmbeddings.map(node => ({
        node,
        score: this.embeddings.cosineSimilarity(queryEmbedding, node.embedding)
      })).sort((a, b) => b.score - a.score);

      // Log performance
      console.log(`Fast retrieval: fast=${fastFilterTime}ms, embedding=${embeddingTime}ms, rerank=${rerankTime}ms`);

      return reranked.slice(0, maxNodes).map(item => ({
        id: item.node.id,
        type: item.node.type,
        content: item.node.data.summary || item.node.data.content.substring(0, 200) + '...', // Use summary for fast mode
        contentType: 'summary',
        similarity: item.score,
        source: 'fast',
        metadata: {
          tags: item.node.data.tags || [],
          importance: item.node.data.importance || 0.5,
          memoryType: item.node.data.memory_type || 'general'
        }
      }));
    }

    // Fallback: return keyword results without reranking
    return candidates.slice(0, maxNodes).map(node => ({
      id: node.id,
      type: node.type,
      content: node.data.summary || node.data.content.substring(0, 200) + '...',
      contentType: 'summary',
      similarity: 0.5, // Default similarity
      source: 'keyword',
      metadata: {
        tags: node.data.tags || [],
        importance: node.data.importance || 0.5,
        memoryType: node.data.memory_type || 'general'
      }
    }));
  }

  async highAccuracyRetrieval(query, agentId, options = {}) {
    const maxNodes = options.maxNodes || this.config.finalLimit || 10;
    const highAccuracyLimit = this.config.highAccuracyLimit || 100;
    const graphDepth = this.config.graphDepth || 2;

    // STEP 1: Expanded keyword search
    const fastStart = Date.now();
    const candidates = await this.graphDB.adapter.fastTextSearch(query, highAccuracyLimit, agentId);
    const fastFilterTime = Date.now() - fastStart;

    let results = [];

    if (candidates.length > 0) {
      // STEP 2: Embedding reranking with more candidates
      const rerankStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      const rerankTime = Date.now() - rerankStart;

      // Rerank by semantic similarity
      const reranked = candidates
        .filter(c => c.embedding)
        .map(node => ({
          node,
          score: this.embeddings.cosineSimilarity(queryEmbedding, node.embedding)
        }))
        .sort((a, b) => b.score - a.score);

      // Take top candidates for graph expansion
      const topCandidates = reranked.slice(0, maxNodes * 2);

      // STEP 3: Graph expansion for deeper context
      const graphStart = Date.now();
      const expandedResults = [];

      for (const candidate of topCandidates) {
        // Get connected nodes for context
        const connected = await this.graphDB.getConnectedNodes(candidate.node.id, graphDepth);

        expandedResults.push({
          ...candidate,
          connectedNodes: connected.nodes.slice(0, 3), // Limit connected nodes
          edges: connected.edges.slice(0, 5)
        });
      }
      const graphTime = Date.now() - graphStart;

      // Log performance
      console.log(`High accuracy retrieval: fast=${fastFilterTime}ms, rerank=${rerankTime}ms, graph=${graphTime}ms`);

      // Format results with full content and context
      results = expandedResults.slice(0, maxNodes).map(item => ({
        id: item.node.id,
        type: item.node.type,
        content: item.node.data.content, // FULL RAW CONTENT
        contentType: 'full',
        similarity: item.score,
        source: 'highAccuracy',
        metadata: {
          summary: item.node.data.summary,
          tags: item.node.data.tags || [],
          entities: item.node.data.entities || [],
          importance: item.node.data.importance || 0.5,
          memoryType: item.node.data.memory_type || 'general',
          confidence: item.node.data.confidence || 0.8
        },
        context: {
          connectedNodes: item.connectedNodes.map(n => ({
            id: n.id,
            type: n.type,
            content: n.data.summary || n.data.content.substring(0, 100) + '...',
            relationship: 'connected'
          })),
          edgeCount: item.edges.length
        }
      }));
    } else {
      // Fallback to vector search if no keyword results
      const embeddingStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      const embeddingTime = Date.now() - embeddingStart;

      const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes, agentId);

      console.log(`High accuracy fallback: embedding=${embeddingTime}ms`);

      results = semanticResults.map(result => ({
        id: result.id,
        type: result.type,
        content: result.data.content, // Full content even in fallback
        contentType: 'full',
        similarity: result.similarity || 0.5,
        source: 'highAccuracy-fallback',
        metadata: {
          summary: result.data.summary,
          tags: result.data.tags || [],
          importance: result.data.importance || 0.5
        }
      }));
    }

    return results;
  }

  // Retrieve by node type
  async retrieveByType(type, limit = 10) {
    const { nodes } = await this.graphDB.queryNodes({
      type: type,
      limit: limit,
      orderBy: 'timestamp DESC'
    });
    return nodes.slice(0, limit);
  }

  // Retrieve connected context
  async retrieveConnected(nodeId, depth = 2) {
    return await this.graphDB.getConnectedNodes(nodeId, depth);
  }

  // Retrieve by time range
  async retrieveByTime(startTime, endTime, type = null) {
    const filters = {
      timeRange: { start: startTime, end: endTime }
    };
    if (type) filters.type = type;

    const { nodes } = await this.graphDB.queryNodes(filters);
    return nodes;
  }
}

module.exports = Retrieval;