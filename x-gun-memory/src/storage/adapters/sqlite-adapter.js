const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { Mutex } = require('async-mutex');
const MigrationManager = require('../../utils/migration-manager');
const BaseAdapter = require('./base-adapter');

class SQLiteAdapter extends BaseAdapter {
  constructor(config) {
    super();
    this.dbPath = config.path;
    this.db = null;
    this.vecAvailable = false;
    this.writeMutex = new Mutex();
  }

  async init() {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.createTables();

    // Run migrations
    const migrationManager = new MigrationManager(this);
    await migrationManager.runMigrations();

    // Try to load sqlite-vec extension
    try {
      this.db.loadExtension(require.resolve('sqlite-vec'));
      this.vecAvailable = true;
      console.log('sqlite-vec extension loaded successfully');
    } catch (error) {
      console.warn('sqlite-vec extension not available, falling back to JS similarity:', error.message);
      this.vecAvailable = false;
    }

    // Create vector table if vec is available
    if (this.vecAvailable) {
      this.createVectorTable();
    }
  }

  createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT,
        embeddings TEXT,
        agent_id TEXT NOT NULL DEFAULT 'global',
        session_id TEXT,
        namespace TEXT,
        memory_type TEXT DEFAULT 'general',
        tags TEXT,
        entities TEXT,
        summary TEXT,
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        content, agent_id,
        content=nodes,
        content_rowid=id
      )`,
      `CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        relationship_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_id) REFERENCES nodes(id),
        FOREIGN KEY (to_id) REFERENCES nodes(id)
      )`,
      `CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      // Indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON nodes(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_agent_id ON nodes(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_type_agent ON nodes(type, agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_timestamp_agent ON nodes(timestamp, agent_id)`,
      // FTS triggers
      `CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes
       BEGIN
         INSERT INTO nodes_fts(rowid, content, agent_id)
         VALUES (new.id, json_extract(new.data, '$.content'), new.agent_id);
       END`,
      `CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes
       BEGIN
         DELETE FROM nodes_fts WHERE rowid = old.id;
       END`,
      `CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes
       BEGIN
         UPDATE nodes_fts SET content = json_extract(new.data, '$.content'), agent_id = new.agent_id
         WHERE rowid = new.id;
       END`,
      `CREATE INDEX IF NOT EXISTS idx_edges_from_id ON edges(from_id)`,
      `CREATE INDEX IF NOT EXISTS idx_edges_to_id ON edges(to_id)`,
      `CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship_type)`
    ];

    for (const query of queries) {
      this.db.prepare(query).run();
    }
  }

  createVectorTable() {
    // Create virtual table for vector search
    this.db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
        id INTEGER PRIMARY KEY,
        embedding float[384]
      )
    `).run();
  }

  async runMigrations() {
    const migrationManager = new MigrationManager(this);
    await migrationManager.runMigrations();
  }

  async fastTextSearch(query, limit = 50, agentId = 'global') {
    try {
      const stmt = this.db.prepare(`
        SELECT n.id, n.type, n.data, n.embeddings, n.agent_id, n.session_id, n.namespace,
               fts.rank
        FROM nodes_fts fts
        JOIN nodes n ON n.id = fts.rowid
        WHERE fts.agent_id = ? AND fts.content MATCH ?
        ORDER BY fts.rank DESC
        LIMIT ?
      `);

      const rows = stmt.all(agentId, query, limit);

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        embedding: row.embeddings ? JSON.parse(row.embeddings) : null,
        agent_id: row.agent_id,
        session_id: row.session_id,
        namespace: row.namespace,
        score: row.rank
      }));
    } catch (error) {
      console.warn('Fast text search error:', error.message);
      return [];
    }
  }

  async createNode(type, data, embedding, agentId = 'global', sessionId = null, namespace = null) {
    const insert = this.db.prepare(
      'INSERT INTO nodes (type, data, embeddings, agent_id, session_id, namespace) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = insert.run(type, JSON.stringify(data), JSON.stringify(embedding), agentId, sessionId, namespace);

    const nodeId = result.lastInsertRowid;

    // Sync to vector table if available
    if (this.vecAvailable && embedding) {
      const vecInsert = this.db.prepare(
        'INSERT INTO vec_nodes (id, embedding) VALUES (?, ?)'
      );
      vecInsert.run(nodeId, Buffer.from(new Float32Array(embedding).buffer));
    }

    return nodeId;
  }

  async createStructuredNode(content, embedding, agentId = 'global', sessionId = null, namespace = null, features = {}) {
    const data = JSON.stringify({
      content,
      ...features
    });

    const insert = this.db.prepare(`
      INSERT INTO nodes (
        type, data, embeddings, agent_id, session_id, namespace,
        memory_type, tags, entities, summary, importance, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      'memory', // type
      data,
      embedding ? JSON.stringify(embedding) : null,
      agentId,
      sessionId,
      namespace,
      features.memory_type || 'general',
      features.tags ? JSON.stringify(features.tags) : null,
      features.entities ? JSON.stringify(features.entities) : null,
      features.summary || '',
      features.importance || 0.5,
      features.confidence || 0.8
    );

    const nodeId = result.lastInsertRowid;

    // Sync to vector table if available
    if (this.vecAvailable && embedding) {
      const vecInsert = this.db.prepare(
        'INSERT INTO vec_nodes (id, embedding) VALUES (?, ?)'
      );
      vecInsert.run(nodeId, Buffer.from(new Float32Array(embedding).buffer));
    }

    return nodeId;
  }

      return nodeId;
    });
  }

  async getNode(id) {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    const row = stmt.get(id);

    if (row) {
      row.data = JSON.parse(row.data);
      if (row.embeddings) {
        row.embeddings = JSON.parse(row.embeddings);
      }
    }

    return row;
  }

  async getNodeByAgent(id, agentId) {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND agent_id = ?');
    const row = stmt.get(id, agentId);

    if (row) {
      row.data = JSON.parse(row.data);
      if (row.embeddings) {
        row.embeddings = JSON.parse(row.embeddings);
      }
    }

    return row;
  }

  async getAllNodesWithEmbeddings() {
    const stmt = this.db.prepare(
      'SELECT id, type, data, embeddings FROM nodes WHERE embeddings IS NOT NULL'
    );
    const rows = stmt.all();

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      embedding: JSON.parse(row.embeddings)
    }));
  }

  async getAllNodesWithEmbeddingsByAgent(agentId) {
    const stmt = this.db.prepare(
      'SELECT id, type, data, embeddings FROM nodes WHERE embeddings IS NOT NULL AND agent_id = ?'
    );
    const rows = stmt.all(agentId);

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      embedding: JSON.parse(row.embeddings)
    }));
  }

  async createEdge(fromId, toId, relationshipType, weight = 1.0) {
    return await this.writeMutex.runExclusive(async () => {
      const insert = this.db.prepare(
        'INSERT INTO edges (from_id, to_id, relationship_type, weight) VALUES (?, ?, ?, ?)'
      );
      const result = insert.run(fromId, toId, relationshipType, weight);
      return result.lastInsertRowid;
    });
  }

  async queryNodes(filters, agentId = 'global') {
    let query = 'SELECT * FROM nodes WHERE agent_id = ?';
    const params = [agentId];

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.timeRange) {
      if (filters.timeRange.start) {
        query += ' AND timestamp >= ?';
        params.push(filters.timeRange.start);
      }
      if (filters.timeRange.end) {
        query += ' AND timestamp <= ?';
        params.push(filters.timeRange.end);
      }
    }

    const nodesStmt = this.db.prepare(query);
    const nodes = nodesStmt.all(...params).map(row => ({
      ...row,
      data: JSON.parse(row.data),
      embeddings: row.embeddings ? JSON.parse(row.embeddings) : null
    }));

    let edges = [];
    if (filters.relationship) {
      const edgesStmt = this.db.prepare(
        'SELECT * FROM edges WHERE relationship_type = ?'
      );
      edges = edgesStmt.all(filters.relationship);
    }

    return { nodes, edges };
  }

  async getConnectedNodes(nodeId, depth) {
    // Simple BFS implementation for connected nodes
    const visited = new Set();
    const queue = [{ id: nodeId, depth: 0 }];
    const nodes = new Map();
    const edges = [];

    while (queue.length > 0) {
      const { id, depth: currentDepth } = queue.shift();

      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      const node = await this.getNode(id);
      if (node) {
        nodes.set(id, node);
      }

      // Get outgoing edges
      const outgoingStmt = this.db.prepare('SELECT * FROM edges WHERE from_id = ?');
      const outgoing = outgoingStmt.all(id);

      // Get incoming edges
      const incomingStmt = this.db.prepare('SELECT * FROM edges WHERE to_id = ?');
      const incoming = incomingStmt.all(id);

      const allEdges = [...outgoing, ...incoming];
      edges.push(...allEdges);

      for (const edge of allEdges) {
        const neighborId = edge.from_id === id ? edge.to_id : edge.from_id;
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, depth: currentDepth + 1 });
        }
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  }

  async vectorSearch(queryEmbedding, k) {
    if (this.vecAvailable) {
      // Use sqlite-vec for efficient search
      const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);
      const stmt = this.db.prepare(`
        SELECT vn.id, n.type, n.data, n.embeddings, distance
        FROM vec_nodes vn
        JOIN nodes n ON n.id = vn.id
        WHERE vn.embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `);
      const rows = stmt.all(queryBuffer, k);

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        embedding: JSON.parse(row.embeddings),
        distance: row.distance
      }));
    } else {
      // Fallback to JS similarity
      const allNodes = await this.getAllNodesWithEmbeddings();
      const results = allNodes.map(node => ({
        ...node,
        distance: this.cosineSimilarity(queryEmbedding, node.embedding)
      }));

      results.sort((a, b) => a.distance - b.distance);
      return results.slice(0, k);
    }
  }

  async findSimilar(embedding, threshold, limit = 5) {
    if (this.vecAvailable) {
      // Use sqlite-vec with threshold
      const queryBuffer = Buffer.from(new Float32Array(embedding).buffer);
      const stmt = this.db.prepare(`
        SELECT vn.id, n.type, n.data, distance
        FROM vec_nodes vn
        JOIN nodes n ON n.id = vn.id
        WHERE vn.embedding MATCH ?
        AND distance <= ?
        ORDER BY distance
        LIMIT ?
      `);
      const rows = stmt.all(queryBuffer, 1 - threshold, limit); // Convert similarity to distance

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        similarity: 1 - row.distance // Convert back to similarity
      }));
    } else {
      // Fallback to JS similarity
      const allNodes = await this.getAllNodesWithEmbeddings();
      const results = allNodes
        .map(node => ({
          ...node,
          similarity: this.cosineSimilarity(embedding, node.embedding)
        }))
        .filter(node => node.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results.map(({ embedding, ...rest }) => rest); // Remove embedding from return
    }
  }

  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async updateNode(id, updates) {
    return await this.writeMutex.runExclusive(async () => {
      const setParts = [];
      const params = [];

      if (updates.data !== undefined) {
        setParts.push('data = ?');
        params.push(JSON.stringify(updates.data));
      }

      if (updates.embeddings !== undefined) {
        setParts.push('embeddings = ?');
        params.push(JSON.stringify(updates.embeddings));

        // Update vector table if available
        if (this.vecAvailable) {
          const vecStmt = this.db.prepare('UPDATE vec_nodes SET embedding = ? WHERE id = ?');
          vecStmt.run(Buffer.from(new Float32Array(updates.embeddings).buffer), id);
        }
      }

      if (setParts.length === 0) {
        return; // Nothing to update
      }

      const sql = `UPDATE nodes SET ${setParts.join(', ')} WHERE id = ?`;
      params.push(id);

      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    });
  }

  async allQuery(queryEmbedding, limit = 10, agentId = 'global') {
    if (this.vecAvailable) {
      // Use sqlite-vec for efficient search
      const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);
      const stmt = this.db.prepare(`
        SELECT vn.id, n.type, n.data, distance
        FROM vec_nodes vn
        JOIN nodes n ON n.id = vn.id
        WHERE vn.embedding MATCH ? AND n.agent_id = ?
        ORDER BY distance
        LIMIT ?
      `);
      const rows = stmt.all(queryBuffer, agentId, limit);

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        similarity: 1 - row.distance // Convert distance to similarity
      }));
    } else {
      // Fallback to JS similarity
      const allNodes = await this.getAllNodesWithEmbeddingsByAgent(agentId);
      const results = allNodes
        .map(node => ({
          ...node,
          similarity: this.cosineSimilarity(queryEmbedding, node.embedding)
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results.map(({ embedding, ...rest }) => rest); // Remove embedding from return
    }
  }

  async getEdges(fromId, toId, relationshipFilter) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];

    if (fromId !== null) {
      sql += ' AND from_id = ?';
      params.push(fromId);
    }

    if (toId !== null) {
      sql += ' AND to_id = ?';
      params.push(toId);
    }

    if (relationshipFilter !== null) {
      sql += ' AND relationship_type = ?';
      params.push(relationshipFilter);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM nodes');
      const result = stmt.get();
      const latency = Date.now() - start;
      return { status: 'ok', latency };
    } catch (error) {
      return { status: 'error', latency: Date.now() - start, error: error.message };
    }
  }
}

module.exports = SQLiteAdapter;