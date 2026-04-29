const RedisClient = require('./redis-client');
const crypto = require('crypto');

class EmbeddingQueue {
  constructor(embeddings, config, batchSize = 32) {
    this.embeddings = embeddings;
    this.batchSize = batchSize;
    this.redis = new RedisClient(config.redis);
    this.processing = false;
    this.maxRetries = 3;
  }

  async enqueue(texts, callback) {
    const job = {
      id: Date.now() + Math.random(),
      texts: texts,
      createdAt: Date.now(),
      retries: 0
    };

    const jobKey = crypto.createHash('sha256').update(JSON.stringify(texts)).digest('hex');

    try {
      // Check for duplicates
      const exists = await this.redis.sismember('embedding_jobs', jobKey);
      if (exists) {
        // Job already exists, return existing result if available
        const result = await this.redis.get(`embedding_result:${job.id}`);
        if (result) {
          if (callback) callback(null, JSON.parse(result).embeddings);
          return job.id;
        }
      }

      // Add to dedup set and queue
      await this.redis.sadd('embedding_jobs', jobKey);
      await this.redis.lpush('embedding_queue', JSON.stringify(job));

      // Start worker if not already running
      if (!this.processing) {
        this.startWorker();
      }

      return job.id;
    } catch (error) {
      console.error('Failed to enqueue embedding job:', error);
      // Fallback to sync processing
      try {
        const result = await this.embeddings.generateBatch(texts, true);
        if (callback) callback(null, result);
        return job.id;
      } catch (syncError) {
        if (callback) callback(syncError, null);
        throw syncError;
      }
    }
  }

  async startWorker() {
    if (this.processing || !this.redis.isEnabled()) return;

    this.processing = true;

    const worker = async () => {
      while (this.processing) {
        try {
          // Use RPOPLPUSH for reliable processing (at-least-once delivery)
          const jobData = await this.redis.rpoplpush('embedding_queue', 'embedding_processing');

          if (!jobData) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before checking again
            continue;
          }

          const job = JSON.parse(jobData);

          try {
            // Process the job
            const embeddings = await this.embeddings.generateBatch(job.texts, true);

            // Store result in Redis for retrieval
            await this.redis.set(`embedding_result:${job.id}`, JSON.stringify({
              status: 'completed',
              embeddings,
              completedAt: Date.now()
            }), 'EX', 3600); // Expire in 1 hour

            // Remove from processing queue (success)
            await this.redis.lrem('embedding_processing', 1, jobData);

          } catch (error) {
            console.error(`Embedding job ${job.id} failed:`, error);

            if (job.retries < this.maxRetries) {
              // Retry with exponential backoff - move back to main queue
              job.retries++;
              await this.redis.lrem('embedding_processing', 1, jobData);
              setTimeout(async () => {
                await this.redis.lpush('embedding_queue', JSON.stringify(job));
              }, Math.pow(2, job.retries) * 1000);
            } else {
              // Store failure result and clean up
              await this.redis.set(`embedding_result:${job.id}`, JSON.stringify({
                status: 'failed',
                error: error.message,
                completedAt: Date.now()
              }), 'EX', 3600);

              await this.redis.lrem('embedding_processing', 1, jobData);
            }
          }

        } catch (error) {
          console.error('Embedding queue worker error:', error);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
        }
      }
    };

    // Start the worker
    worker().catch(error => {
      console.error('Embedding queue worker crashed:', error);
      this.processing = false;
    });
  }

  async getResult(jobId) {
    if (!this.redis.isEnabled()) return null;

    try {
      const result = await this.redis.get(`embedding_result:${jobId}`);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      console.error('Failed to get embedding result:', error);
      return null;
    }
  }

  // Synchronous version for immediate processing
  async processSync(texts) {
    return await this.embeddings.generateBatch(texts, true);
  }

  async stop() {
    this.processing = false;
  }
}

module.exports = EmbeddingQueue;