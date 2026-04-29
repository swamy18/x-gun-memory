const fs = require('fs');
const path = require('path');
require('dotenv').config();

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Environment variable mappings
const envMappings = {
  STORAGE_TYPE: 'storage.type',
  POSTGRES_CONNECTION_STRING: 'storage.postgres.connectionString',
  REDIS_HOST: 'redis.host',
  REDIS_PORT: 'redis.port',
  REDIS_ENABLED: 'redis.enabled',
  MCP_PORT: 'mcp.port',
  API_PORT: 'api.port',
  API_HOST: 'api.host',
  LOG_LEVEL: 'logging.level',
  DEFAULT_AGENT_ID: 'agents.defaultAgentId',
  AUTH_ENABLED: 'auth.enabled'
};

// Override config with environment variables
Object.entries(envMappings).forEach(([envVar, configPath]) => {
  const value = process.env[envVar];
  if (value !== undefined) {
    const keys = configPath.split('.');
    let current = config;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    // Convert string values to appropriate types
    if (['port', 'maxTags', 'maxEntities', 'defaultMaxNodes', 'defaultTraverseDepth', 'summaryLength', 'fastLimit', 'finalLimit', 'highAccuracyLimit', 'graphDepth', 'lruCacheSize', 'batchSize'].includes(lastKey)) {
      current[lastKey] = parseInt(value, 10);
    } else if (['enabled'].includes(lastKey)) {
      current[lastKey] = value.toLowerCase() === 'true';
    } else if (['similarityThreshold', 'mergeThreshold', 'updateThreshold', 'highRelevanceThreshold', 'lowRelevanceThreshold', 'semantic', 'graph'].includes(lastKey)) {
      current[lastKey] = parseFloat(value);
    } else {
      current[lastKey] = value;
    }
  }
});

module.exports = config;