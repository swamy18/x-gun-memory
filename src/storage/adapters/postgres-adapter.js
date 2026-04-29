const { Pool } = require('pg');
const MigrationManager = require('../../utils/migration-manager');
const BaseAdapter = require('./base-adapter');

class PostgresAdapter extends BaseAdapter {
  constructor(config) {
    super();
    this.connectionString = config.connectionString;
    this.pool = null;
  }

  async init() {
    this.pool = new Pool({ connectionString: this.connectionString });

    // Create tables and indexes
    await this.createTables();

    // Run migrations
    await this.runMigrations();

    // Create vector extension if not exists
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (error) {
      console.warn('pgvector extension not available:', error.message);
    }
  }

  async createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS nodes (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        data JSONB,
        embedding vector(384),
        agent_id TEXT NOT NULL DEFAULT 'global',
        session_id TEXT,
        namespace TEXT,
        memory_type TEXT DEFAULT 'general',
        tags TEXT[],
        entities TEXT[],
        summary TEXT,
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8,
        text_search tsvector,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS edges (
        id SERIAL PRIMARY KEY,
        from_id INTEGER NOT NULL REFERENCES nodes(id),
        to_id INTEGER NOT NULL REFERENCES nodes(id),
        relationship_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value JSONB
      )`,
      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON nodes(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_agent_id ON nodes(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_type_agent ON nodes(type, agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_timestamp_agent ON nodes(timestamp, agent_id)`,
      // Full-text search index
      `CREATE INDEX IF NOT EXISTS idx_nodes_text_search ON nodes USING GIN(text_search)`,
      // Vector index (requires pgvector)
      `CREATE INDEX IF NOT EXISTS idx_nodes_embedding ON nodes USING ivfflat (embedding vector_cosine_ops)`,
      // Trigger for auto-updating tsvector
      `CREATE OR REPLACE FUNCTION update_text_search() RETURNS trigger AS $$
      BEGIN
        NEW.text_search := to_tsvector('english', COALESCE(NEW.data->>'content', ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trigger_update_text_search ON nodes`,
      `CREATE TRIGGER trigger_update_text_search
       BEFORE INSERT OR UPDATE ON nodes
       FOR EACH ROW EXECUTE FUNCTION update_text_search()`
    ];

    for (const query of queries) {
      try {
        await this.pool.query(query);
      } catch (error) {
        console.warn(`Failed to execute query: ${query}`, error.message);
      }
    }
  }

  async createNode(type, data, embedding, agentId = 'global', sessionId = null, namespace = null) {
    const query = `
      INSERT INTO nodes (type, data, embedding, agent_id, session_id, namespace)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const result = await this.pool.query(query, [type, data, `[${embedding.join(',')}]`, agentId, sessionId, namespace]);
    return result.rows[0].id;
  }

  async createStructuredNode(content, embedding, agentId = 'global', sessionId = null, namespace = null, features = {}) {
    const data = {
      content,
      ...features
    };

    const query = `
      INSERT INTO nodes (
        type, data, embedding, agent_id, session_id, namespace,
        memory_type, tags, entities, summary, importance, confidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `;

    const params = [
      'memory', // type
      data,
      embedding ? `[${embedding.join(',')}]` : null,
      agentId,
      sessionId,
      namespace,
      features.memory_type || 'general',
      features.tags || [],
      features.entities || [],
      features.summary || '',
      features.importance || 0.5,
      features.confidence || 0.8
    ];

    const result = await this.pool.query(query, params);
    return result.rows[0].id;
  }

  async getNode(id) {
    const query = 'SELECT * FROM nodes WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    const row = result.rows[0];

    if (row) {
      // Convert vector to array
      if (row.embedding) {
        row.embedding = row.embedding.map(v => parseFloat(v));
      }
    }

    return row;
  }

  async getAllNodesWithEmbeddings() {
    const query = 'SELECT id, type, data, embedding FROM nodes WHERE embedding IS NOT NULL';
    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      data: row.data,
      embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null
    }));
  }

  async createEdge(fromId, toId, relationshipType, weight = 1.0) {
    const query = `
      INSERT INTO edges (from_id, to_id, relationship_type, weight)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    const result = await this.pool.query(query, [fromId, toId, relationshipType, weight]);
    return result.rows[0].id;
  }

  async queryNodes(filters, agentId = 'global') {
    let query = 'SELECT * FROM nodes WHERE agent_id = $1';
    const params = [agentId];
    let paramIndex = 2;

    if (filters.type) {
      query += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters.timeRange) {
      if (filters.timeRange.start) {
        query += ` AND timestamp >= $${paramIndex}`;
        params.push(filters.timeRange.start);
        paramIndex++;
      }
      if (filters.timeRange.end) {
        query += ` AND timestamp <= $${paramIndex}`;
        params.push(filters.timeRange.end);
        paramIndex++;
      }
    }

    const result = await this.pool.query(query, params);
    const nodes = result.rows.map(row => ({
      ...row,
      embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null
    }));

    let edges = [];
    if (filters.relationship) {
      const edgesQuery = 'SELECT * FROM edges WHERE relationship_type = $1';
      const edgesResult = await this.pool.query(edgesQuery, [filters.relationship]);
      edges = edgesResult.rows;
    }

    return { nodes, edges };
  }

  async getConnectedNodes(nodeId, depth) {
    // Recursive CTE for graph traversal
    const query = `
      WITH RECURSIVE connected AS (
        SELECT id, type, data, embedding, 0 as depth
        FROM nodes
        WHERE id = $1

        UNION ALL

        SELECT n.id, n.type, n.data, n.embedding, c.depth + 1
        FROM nodes n
        JOIN edges e ON (e.from_id = n.id OR e.to_id = n.id)
        JOIN connected c ON (
          (e.from_id = c.id AND e.to_id = n.id) OR
          (e.to_id = c.id AND e.from_id = n.id)
        )
        WHERE c.depth < $2 AND n.id != c.id
      )
      SELECT DISTINCT * FROM connected
    `;

    const result = await this.pool.query(query, [nodeId, depth]);
    const nodes = result.rows.map(row => ({
      ...row,
      embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null
    }));

    // Get edges between these nodes
    const nodeIds = nodes.map(n => n.id);
    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    const edgesQuery = `
      SELECT * FROM edges
      WHERE from_id = ANY($1) AND to_id = ANY($1)
    `;
    const edgesResult = await this.pool.query(edgesQuery, [nodeIds]);
    const edges = edgesResult.rows;

    return { nodes, edges };
  }

  async vectorSearch(queryEmbedding, k) {
    try {
      // Use pgvector cosine distance
      const query = `
        SELECT id, type, data, embedding, (embedding <=> $1) as distance
        FROM nodes
        WHERE embedding IS NOT NULL
        ORDER BY distance
        LIMIT $2
      `;
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const result = await this.pool.query(query, [vectorStr, k]);

      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        data: row.data,
        embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null,
        distance: parseFloat(row.distance)
      }));
    } catch (error) {
      console.warn('pgvector search failed, falling back to JS similarity:', error.message);
      // Fallback to JS similarity
      const allNodes = await this.getAllNodesWithEmbeddings();
      const results = allNodes.map(node => ({
        ...node,
        similarity: this.cosineSimilarity(queryEmbedding, node.embedding)
      }));

      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, k);
    }
  }

  async findSimilar(embedding, threshold, limit = 5, agentId = 'global') {
    try {
      // Use pgvector with similarity threshold
      const query = `
        SELECT id, type, data, (1 - (embedding <=> $1)) as similarity
        FROM nodes
        WHERE embedding IS NOT NULL
        AND agent_id = $2
        AND (1 - (embedding <=> $1)) >= $3
        ORDER BY similarity DESC
        LIMIT $4
      `;
      const vectorStr = `[${embedding.join(',')}]`;
      const result = await this.pool.query(query, [vectorStr, agentId, threshold, limit]);

      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        data: row.data,
        similarity: parseFloat(row.similarity)
      }));
    } catch (error) {
      console.warn('pgvector findSimilar failed, falling back to JS similarity:', error.message);
      // Fallback to JS similarity
      const query = 'SELECT id, type, data, embedding FROM nodes WHERE embedding IS NOT NULL AND agent_id = $1';
      const nodeResult = await this.pool.query(query, [agentId]);
      const allNodes = nodeResult.rows.map(row => ({
        id: row.id,
        type: row.type,
        data: row.data,
        embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null
      }));
      const results = allNodes
        .map(node => ({
          ...node,
          similarity: this.cosineSimilarity(embedding, node.embedding)
        }))
        .filter(node => node.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results.map(({ embedding, ...rest }) => rest);
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
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async runMigrations() {
    const migrationManager = new MigrationManager(this);
    await migrationManager.runMigrations();
  }

  async fastTextSearch(query, limit = 50, agentId = 'global') {
    try {
      const sql = `
        SELECT id, type, data, embedding, agent_id, session_id, namespace
        FROM nodes
        WHERE agent_id = $1 AND text_search @@ plainto_tsquery('english', $2)
        ORDER BY ts_rank(text_search, plainto_tsquery('english', $2)) DESC
        LIMIT $3
      `;
      const result = await this.pool.query(sql, [agentId, query, limit]);

      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        data: row.data,
        embedding: row.embedding ? row.embedding.map(v => parseFloat(v)) : null,
        agent_id: row.agent_id,
        session_id: row.session_id,
        namespace: row.namespace
      }));
    } catch (error) {
      console.warn('Fast text search error:', error.message);
      return [];
    }
  }

  async updateNode(id, updates) {
    const setParts = [];
    const params = [];
    let paramIndex = 1;

    if (updates.data !== undefined) {
      setParts.push(`data = $${paramIndex++}`);
      params.push(JSON.stringify(updates.data));
    }

    if (updates.embeddings !== undefined) {
      setParts.push(`embedding = $${paramIndex++}`);
      params.push(JSON.stringify(updates.embeddings));
    }

    if (setParts.length === 0) {
      return; // Nothing to update
    }

    const sql = `UPDATE nodes SET ${setParts.join(', ')} WHERE id = $${paramIndex++}`;
    params.push(id);

    await this.pool.query(sql, params);
  }

  async allQuery(queryEmbedding, limit = 10, agentId = 'global') {
    // Use pgvector for efficient search
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const sql = `
      SELECT id, type, data, 1 - (embedding <=> $1::vector) as similarity
      FROM nodes
      WHERE embedding IS NOT NULL AND agent_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
    const result = await this.pool.query(sql, [embeddingStr, agentId, limit]);
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      data: row.data,
      similarity: parseFloat(row.similarity)
    }));
  }

  async getEdges(fromId, toId, relationshipFilter) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (fromId !== null) {
      sql += ` AND from_id = $${paramIndex++}`;
      params.push(fromId);
    }

    if (toId !== null) {
      sql += ` AND to_id = $${paramIndex++}`;
      params.push(toId);
    }

    if (relationshipFilter !== null) {
      sql += ` AND relationship_type = $${paramIndex++}`;
      params.push(relationshipFilter);
    }

    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async healthCheck() {
    const start = Date.now();
    try {
      await this.pool.query('SELECT COUNT(*) FROM nodes');
      const latency = Date.now() - start;
      return { status: 'ok', latency };
    } catch (error) {
      return { status: 'error', latency: Date.now() - start, error: error.message };
    }
  }
}

module.exports = PostgresAdapter;
