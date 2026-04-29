class GraphTraversal {
  constructor(graphDB) {
    this.graphDB = graphDB;
  }

  // Breadth-first search from a starting node
  async bfs(startNodeId, maxDepth = 3, relationshipFilter = null) {
    const visited = new Set();
    const queue = [{ nodeId: startNodeId, depth: 0, path: [] }];
    const result = [];

    while (queue.length > 0) {
      const { nodeId, depth, path } = queue.shift();

      if (visited.has(nodeId) || depth > maxDepth) {
        continue;
      }

      visited.add(nodeId);

      const node = await this.graphDB.getNode(nodeId);
      if (node) {
        result.push({
          node,
          depth,
          path: [...path, nodeId]
        });
      }

      // Get outgoing edges
      const edges = await this.graphDB.getEdges(nodeId, null, relationshipFilter);
      for (const edge of edges) {
        if (!visited.has(edge.to_id)) {
          queue.push({
            nodeId: edge.to_id,
            depth: depth + 1,
            path: [...path, nodeId]
          });
        }
      }

      // Get incoming edges
      const incomingEdges = await this.graphDB.getEdges(null, nodeId, relationshipFilter);
      for (const edge of incomingEdges) {
        if (!visited.has(edge.from_id)) {
          queue.push({
            nodeId: edge.from_id,
            depth: depth + 1,
            path: [...path, nodeId]
          });
        }
      }
    }

    return result;
  }



  // Get subgraph within depth
  async getSubgraph(startNodeId, depth = 2, relationshipFilter = null) {
    const traversal = await this.bfs(startNodeId, depth, relationshipFilter);
    const nodes = traversal.map(t => t.node);
    const edges = [];

    // Collect edges between traversed nodes
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const nodeId of nodeIds) {
      const nodeEdges = await this.graphDB.getEdges(nodeId, null, relationshipFilter);
      for (const edge of nodeEdges) {
        if (nodeIds.has(edge.to_id)) {
          edges.push(edge);
        }
      }
    }

    return { nodes, edges };
  }
}

module.exports = GraphTraversal;