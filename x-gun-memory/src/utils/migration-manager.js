class MigrationManager {
  constructor(adapter) {
    this.adapter = adapter;
    this.currentVersion = 3;
  }

  async getCurrentVersion() {
    try {
      if (this.adapter.constructor.name === 'SQLiteAdapter') {
        const result = this.adapter.db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
        return result ? result.version : 0;
      } else if (this.adapter.constructor.name === 'PostgresAdapter') {
        const result = await this.adapter.pool.query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
        return result.rows.length > 0 ? result.rows[0].version : 0;
      }
    } catch (error) {
      // Table doesn't exist yet
      return 0;
    }
    return 0;
  }

  async runMigrations() {
    const currentVersion = await this.getCurrentVersion();

    if (currentVersion < this.currentVersion) {
      console.log(`Running migrations from version ${currentVersion} to ${this.currentVersion}`);

      for (let version = currentVersion + 1; version <= this.currentVersion; version++) {
        await this.runMigration(version);
        await this.updateVersion(version);
      }
    }
  }

  async runMigration(version) {
    console.log(`Applying migration ${version}`);

    const migrations = {
      1: this.migration1.bind(this)
    };

    if (migrations[version]) {
      await migrations[version]();
    }
  }

  async migration1() {
    // Migration 1: Add agent fields and indexes
    if (this.adapter.constructor.name === 'SQLiteAdapter') {
      await this.adapter.db.exec(`
        ALTER TABLE nodes ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE nodes ADD COLUMN session_id TEXT;
        ALTER TABLE nodes ADD COLUMN namespace TEXT;

        CREATE INDEX IF NOT EXISTS idx_nodes_agent_id ON nodes(agent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
        CREATE INDEX IF NOT EXISTS idx_nodes_type_agent ON nodes(type, agent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_timestamp_agent ON nodes(timestamp, agent_id);

        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else if (this.adapter.constructor.name === 'PostgresAdapter') {
      await this.adapter.pool.query(`
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS session_id TEXT;
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS namespace TEXT;
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS text_search tsvector;

        CREATE INDEX IF NOT EXISTS idx_nodes_agent_id ON nodes(agent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
        CREATE INDEX IF NOT EXISTS idx_nodes_type_agent ON nodes(type, agent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_timestamp_agent ON nodes(timestamp, agent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_text_search ON nodes USING GIN(text_search);

        CREATE OR REPLACE FUNCTION update_text_search() RETURNS trigger AS $$
        BEGIN
          NEW.text_search := to_tsvector('english', COALESCE(NEW.data->>'content', ''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_update_text_search ON nodes;
        CREATE TRIGGER trigger_update_text_search
         BEFORE INSERT OR UPDATE ON nodes
         FOR EACH ROW EXECUTE FUNCTION update_text_search();

        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  }

  async migration2() {
    // Migration 2: Add full-text search
    if (this.adapter.constructor.name === 'SQLiteAdapter') {
      await this.adapter.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          content, agent_id,
          content=nodes,
          content_rowid=id
        );

        CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes
        BEGIN
          INSERT INTO nodes_fts(rowid, content, agent_id)
          VALUES (new.id, json_extract(new.data, '$.content'), new.agent_id);
        END;

        CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes
        BEGIN
          DELETE FROM nodes_fts WHERE rowid = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes
        BEGIN
          UPDATE nodes_fts SET content = json_extract(new.data, '$.content'), agent_id = new.agent_id
          WHERE rowid = new.id;
        END;

        -- Populate existing data
        INSERT OR IGNORE INTO nodes_fts(rowid, content, agent_id)
        SELECT id, json_extract(data, '$.content'), agent_id FROM nodes;
      `);
    } else if (this.adapter.constructor.name === 'PostgresAdapter') {
      // Already handled in migration 1
    }
  }

  async migration3() {
    // Migration 3: Add semi-structured memory fields
    if (this.adapter.constructor.name === 'SQLiteAdapter') {
      await this.adapter.db.exec(`
        ALTER TABLE nodes ADD COLUMN memory_type TEXT DEFAULT 'general';
        ALTER TABLE nodes ADD COLUMN tags TEXT;
        ALTER TABLE nodes ADD COLUMN entities TEXT;
        ALTER TABLE nodes ADD COLUMN summary TEXT;
        ALTER TABLE nodes ADD COLUMN importance REAL DEFAULT 0.5;
        ALTER TABLE nodes ADD COLUMN confidence REAL DEFAULT 0.8;
      `);
    } else if (this.adapter.constructor.name === 'PostgresAdapter') {
      await this.adapter.pool.query(`
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS memory_type TEXT DEFAULT 'general';
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags TEXT[];
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS entities TEXT[];
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS summary TEXT;
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS importance REAL DEFAULT 0.5;
        ALTER TABLE nodes ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 0.8;
      `);
    }
  }

  async updateVersion(version) {
    if (this.adapter.constructor.name === 'SQLiteAdapter') {
      this.adapter.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    } else if (this.adapter.constructor.name === 'PostgresAdapter') {
      await this.adapter.pool.query('INSERT INTO schema_version (version) VALUES ($1)', [version]);
    }
  }
}

module.exports = MigrationManager;