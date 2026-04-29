const Redis = require('ioredis');

class RedisClient {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.client = null;

    if (this.enabled) {
      this.client = new Redis({
        host: config.host || process.env.REDIS_HOST || '127.0.0.1',
        port: config.port || process.env.REDIS_PORT || 6379,
        password: config.password || process.env.REDIS_PASSWORD,
        db: config.db || 0,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.client.on('error', (err) => {
        console.warn('Redis connection error:', err.message);
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
      });
    }
  }

  async get(key) {
    if (!this.enabled || !this.client) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      console.warn('Redis GET error:', error.message);
      return null;
    }
  }

  async set(key, value, ...args) {
    if (!this.enabled || !this.client) return;
    try {
      return await this.client.set(key, value, ...args);
    } catch (error) {
      console.warn('Redis SET error:', error.message);
    }
  }

  async del(pattern) {
    if (!this.enabled || !this.client) return 0;
    try {
      if (pattern.includes('*')) {
        // Safe pattern deletion using SCAN
        return await this.deleteByPattern(pattern);
      } else {
        return await this.client.del(pattern);
      }
    } catch (error) {
      console.warn('Redis DEL error:', error.message);
      return 0;
    }
  }

  async deleteByPattern(pattern) {
    let cursor = 0;
    let deletedCount = 0;
    const batchSize = 100;

    do {
      const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        const count = await this.client.del(...keys);
        deletedCount += count;
      }
    } while (cursor !== '0');

    return deletedCount;
  }

  async lpush(key, value) {
    if (!this.enabled || !this.client) return;
    try {
      return await this.client.lpush(key, value);
    } catch (error) {
      console.warn('Redis LPUSH error:', error.message);
    }
  }



  async keys(pattern) {
    if (!this.enabled || !this.client) return [];
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      console.warn('Redis KEYS error:', error.message);
      return [];
    }
  }

  async rpoplpush(source, destination) {
    if (!this.enabled || !this.client) return null;
    try {
      return await this.client.rpoplpush(source, destination);
    } catch (error) {
      console.warn('Redis RPOPLPUSH error:', error.message);
      return null;
    }
  }

  async lrem(key, count, value) {
    if (!this.enabled || !this.client) return 0;
    try {
      return await this.client.lrem(key, count, value);
    } catch (error) {
      console.warn('Redis LREM error:', error.message);
      return 0;
    }
  }

  async sadd(key, ...members) {
    if (!this.enabled || !this.client) return 0;
    try {
      return await this.client.sadd(key, ...members);
    } catch (error) {
      console.warn('Redis SADD error:', error.message);
      return 0;
    }
  }

  async sismember(key, member) {
    if (!this.enabled || !this.client) return 0;
    try {
      return await this.client.sismember(key, member);
    } catch (error) {
      console.warn('Redis SISMEMBER error:', error.message);
      return 0;
    }
  }

  async setnx(key, value) {
    if (!this.enabled || !this.client) return 0;
    try {
      return await this.client.set(key, value, 'NX', 'EX', 30); // 30 second lock
    } catch (error) {
      console.warn('Redis SETNX error:', error.message);
      return null;
    }
  }



  isEnabled() {
    return this.enabled && this.client;
  }
}

module.exports = RedisClient;