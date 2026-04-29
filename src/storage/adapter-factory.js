/**
 * Factory for creating storage adapters based on config.
 */
class AdapterFactory {
  /**
   * Create an adapter instance.
   * @param {object} config - Storage configuration from config.json
   * @returns {BaseAdapter} Adapter instance
   */
  static createAdapter(config) {
    const { type, ...adapterConfigs } = config;

    switch (type) {
      case 'sqlite':
        try {
          const SQLiteAdapter = require('./adapters/sqlite-adapter');
          const sqliteConfig = adapterConfigs.sqlite || { path: './data/x-gun-memory.db' };
          if (!sqliteConfig.path) {
            sqliteConfig.path = './data/x-gun-memory.db';
          }
          return new SQLiteAdapter(sqliteConfig);
        } catch (error) {
          throw new Error(`SQLite adapter failed to load: ${error.message}. Make sure better-sqlite3 is installed.`);
        }
      case 'postgres':
        try {
          const PostgresAdapter = require('./adapters/postgres-adapter');
          return new PostgresAdapter(adapterConfigs.postgres);
        } catch (error) {
          throw new Error(`PostgreSQL adapter failed to load: ${error.message}`);
        }
      case 'memory':
        const MemoryAdapter = require('./adapters/memory-adapter');
        return new MemoryAdapter(adapterConfigs.memory || {});
      default:
        throw new Error(`Unknown storage type: ${type}. Supported types: sqlite, postgres, memory`);
    }
  }
}

module.exports = AdapterFactory;
