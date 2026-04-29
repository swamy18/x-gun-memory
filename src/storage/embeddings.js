const { pipeline } = require('@xenova/transformers');
const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const EmbeddingQueue = require('../utils/embedding-queue');
const RedisClient = require('../utils/redis-client');

class Embeddings {
  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', cacheSize = 1000, useQueue = true, config = {}) {
    this.modelName = modelName;
    this.extractor = null;

    // LRU cache as fallback/primary for fast access
    this.lruCache = new LRUCache({
      max: cacheSize,
      ttl: 1000 * 60 * 60 * 24, // 24 hours
      allowStale: false,
      updateAgeOnGet: true
    });

    // Redis for distributed caching
    this.redis = new RedisClient(config.redis);

    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.useQueue = useQueue;
    this.queue = useQueue ? new EmbeddingQueue(this, config) : null;
  }

  async init() {
    if (!this.extractor) {
      console.log('Loading embedding model...');
      this.extractor = await pipeline('feature-extraction', this.modelName);
      console.log('Embedding model loaded.');
    }
  }

  /**
   * Generate SHA256 hash of text for caching.
   * @param {string} text - Input text
   * @returns {string} Hash string
   */
  hashText(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generate embedding for single text with caching.
   * @param {string} text - Input text
   * @returns {Promise<number[]>} Embedding vector
   */
  async generate(text) {
    if (!this.extractor) {
      await this.init();
    }

    const hash = this.hashText(text);
    const redisKey = `emb:${hash}`;
    const lockKey = `emb:${hash}:lock`;

    // Check Redis cache first
    if (this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get(redisKey);
        if (cached) {
          const embedding = JSON.parse(cached);
          this.lruCache.set(hash, embedding); // Also cache in LRU
          this.cacheHits++;
          return embedding;
        }
      } catch (error) {
        console.warn('Redis cache read error:', error.message);
      }
    }

    // Check LRU cache
    let embedding = this.lruCache.get(hash);
    if (embedding) {
      this.cacheHits++;
      return embedding;
    }

    this.cacheMisses++;

    // Cache stampede protection: try to acquire lock
    if (this.redis.isEnabled()) {
      try {
        const lockAcquired = await this.redis.setnx(lockKey, '1');
        if (!lockAcquired) {
          // Another process is computing, wait and retry
          await new Promise(resolve => setTimeout(resolve, 100));
          return await this.generate(text); // Recursive retry
        }
      } catch (error) {
        console.warn('Redis lock error:', error.message);
      }
    }

    try {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      embedding = Array.from(output.data);

      // Cache in both places
      this.lruCache.set(hash, embedding);
      if (this.redis.isEnabled()) {
        try {
          await this.redis.set(redisKey, JSON.stringify(embedding), 'EX', 86400); // 24 hours
        } catch (error) {
          console.warn('Redis cache write error:', error.message);
        }
      }

      return embedding;
    } finally {
      // Always release lock
      if (this.redis.isEnabled()) {
        try {
          await this.redis.del(lockKey);
        } catch (error) {
          console.warn('Redis unlock error:', error.message);
        }
      }
    }
  }

  /**
   * Generate embeddings for multiple texts in batch.
   * @param {string[]} texts - Array of input texts
   * @param {boolean} sync - Force synchronous processing
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async generateBatch(texts, sync = false) {
    if (!this.extractor) {
      await this.init();
    }

    const results = [];
    const uncachedTexts = [];
    const uncachedIndices = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const hash = this.hashText(texts[i]);
      const cached = this.cache.get(hash);

      if (cached) {
        this.cacheHits++;
        results[i] = cached;
      } else {
        this.cacheMisses++;
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      if (this.useQueue && !sync) {
        // Use queue for async processing
        return new Promise((resolve, reject) => {
          this.queue.enqueue(uncachedTexts, (error, embeddings) => {
            if (error) {
              reject(error);
              return;
            }

            // Process results and update cache
            for (let i = 0; i < uncachedTexts.length; i++) {
              const embedding = embeddings[i];
              const originalIndex = uncachedIndices[i];
              const hash = this.hashText(uncachedTexts[i]);

              results[originalIndex] = embedding;
              this.cache.set(hash, embedding);
            }

            resolve(results);
          });
        });
      } else {
        // Synchronous processing
        const outputs = await this.extractor(uncachedTexts, { pooling: 'mean', normalize: true });

        // outputs is array of {data: Float32Array}
        for (let i = 0; i < uncachedTexts.length; i++) {
          const embedding = Array.from(outputs[i].data);
          const originalIndex = uncachedIndices[i];
          const hash = this.hashText(uncachedTexts[i]);

          results[originalIndex] = embedding;
          this.cache.set(hash, embedding);
        }
      }
    }

    return results;
  }

  /**
   * Get cache statistics.
   * @returns {object} Stats object
   */
  getStats() {
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      lruCacheSize: this.lruCache.size,
      redisEnabled: this.redis.isEnabled(),
      avgLatencyMs: 0 // Could track this with timing
    };
  }

  // Cosine similarity between two vectors
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Find most similar vectors (legacy method, now uses vectorSearch in adapters)
  findSimilar(queryEmbedding, embeddings, topK = 5) {
    const similarities = embeddings.map((emb, index) => ({
      index,
      similarity: this.cosineSimilarity(queryEmbedding, emb.embedding),
      nodeId: emb.nodeId
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK);
  }
}

module.exports = Embeddings;