const HybridScorer = require('./hybrid-scorer');

class Retrieval {
  constructor(graphDB, embeddings, config) {
    this.graphDB = graphDB;
    this.embeddings = embeddings;
    this.config = (config && config.retrieval) || {};
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
    const agentId = options.agentId || 'global';
    const scope = {
      sessionId: options.sessionId || null,
      namespace: options.namespace || null
    };

    const isHighAccuracy = this.shouldUseHighAccuracy(query, options);

    const startTime = Date.now();

    let results;
    if (isHighAccuracy) {
      results = await this.highAccuracyRetrieval(query, agentId, options, scope);
    } else {
      results = await this.fastRetrieval(query, agentId, options, scope);
    }

    const totalTime = Date.now() - startTime;

    console.log(`Retrieval: mode=${isHighAccuracy ? 'highAccuracy' : 'fast'}, time=${totalTime}ms, results=${results.length}`);

    return results;
  }

  async fastRetrieval(query, agentId, options = {}, scope = {}) {
    const maxNodes = options.maxNodes || this.config.defaultMaxNodes || 5;
    const fastLimit = this.config.fastLimit || 50;

    // STEP 1: Fast keyword/text search
    const fastStart = Date.now();
    let candidates = await this.graphDB.adapter.fastTextSearch(query, fastLimit, agentId, scope);
    const fastFilterTime = Date.now() - fastStart;

    // If no keyword results, fallback to full vector search
    let embeddingTime = 0;
    if (candidates.length === 0) {
      const embeddingStart = Date.now();
      const queryEmbedding = await this.embeddings.generate(query);
      embeddingTime = Date.now() - embeddingStart;

      const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes * 2, agentId, scope);
      candidates = semanticResults.map(result => ({
        ...result,
        data: result.data,
        embedding: result.embedding
      }));
    }

    return this.fastRetrievalLogic(query, candidates, maxNodes, fastFilterTime, embeddingTime);
  }

  async fastRetrievalLogic(query, candidates, maxNodes, fastFilterTime, embeddingTime) {
    // STEP 2: Embedding-based reranking (if we have candidates with embeddings)
    const candidatesWithEmbeddings = candidates.filter(c => c.embedding);

    if (candidatesWithEmbeddings.length > 0) {
      const rerankStart = Date.now();
      let reranked;
      if (this.config.useHybridScoring) {
        const weights = this.config.hybridWeights || { semantic: 0.7, graph: 0.3 };
        const scored = await this.hybridScorer.score(query, candidatesWithEmbeddings, weights);
        reranked = scored.map(node => ({
          node,
          score: node.hybridScore
        }));
      } else {
        const queryEmbedding = await this.embeddings.generate(query);
        reranked = candidatesWithEmbeddings.map(node => ({
          node,
          score: this.embeddings.cosineSimilarity(queryEmbedding, node.embedding)
        })).sort((a, b) => b.score - a.score);
      }
      const rerankTime = Date.now() - rerankStart;

      // Log performance
      console.log(`Fast retrieval: fast=${fastFilterTime}ms, embedding=${embeddingTime}ms, rerank=${rerankTime}ms`);

      return reranked.slice(0, maxNodes).map(item => {
        const processed = this.processContent(item.node.data.content, item.score, this.config);
        const fallbackBoundary = this.findSentenceBoundary(item.node.data.content || '', 200);
        const fallbackSummary = (item.node.data.content || '').slice(0, fallbackBoundary) + ((item.node.data.content || '').length > fallbackBoundary ? '...' : '');
        return {
          id: item.node.id,
          type: item.node.type,
          content: processed.content || item.node.data.summary || fallbackSummary,
          contentType: processed.contentType === 'skipped' ? 'summary' : processed.contentType,
          similarity: item.score,
          source: 'fast',
          metadata: {
            tags: item.node.data.tags || [],
            importance: item.node.data.importance || 0.5,
            memoryType: item.node.data.memory_type || 'general'
          }
        };
      });
    }

    // Fallback: return keyword results without reranking
    return candidates.slice(0, maxNodes).map(node => {
      const processed = this.processContent(node.data.content, 0.61, this.config);
      const fallbackBoundary = this.findSentenceBoundary(node.data.content || '', 200);
      const fallbackSummary = (node.data.content || '').slice(0, fallbackBoundary) + ((node.data.content || '').length > fallbackBoundary ? '...' : '');
      return {
        id: node.id,
        type: node.type,
        content: processed.content || node.data.summary || fallbackSummary,
        contentType: processed.contentType === 'skipped' ? 'summary' : processed.contentType,
        similarity: 0.5, // Default similarity
        source: 'keyword',
        metadata: {
          tags: node.data.tags || [],
          importance: node.data.importance || 0.5,
          memoryType: node.data.memory_type || 'general'
        }
      };
    });
  }

  async highAccuracyRetrieval(query, agentId, options = {}, scope = {}) {
    const maxNodes = options.maxNodes || this.config.finalLimit || 10;
    const highAccuracyLimit = this.config.highAccuracyLimit || 100;
    const graphDepth = this.config.graphDepth || 2;

    // STEP 1: Expanded keyword search
    const fastStart = Date.now();
    const candidates = await this.graphDB.adapter.fastTextSearch(query, highAccuracyLimit, agentId, scope);
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

      const semanticResults = await this.graphDB.allQuery(queryEmbedding, maxNodes, agentId, scope);

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


}

module.exports = Retrieval;
