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

  // Get connected component
  async getConnectedComponent(startNodeId, relationshipFilter = null) {
    const visited = new Set();
    const stack = [startNodeId];
    const component = new Set();

    while (stack.length > 0) {
      const nodeId = stack.pop();

      if (visited.has(nodeId)) {
        continue;
      }

      visited.add(nodeId);
      component.add(nodeId);

      // Get neighbors
      const outgoing = await this.graphDB.getEdges(nodeId, null, relationshipFilter);
      const incoming = await this.graphDB.getEdges(null, nodeId, relationshipFilter);

      for (const edge of [...outgoing, ...incoming]) {
        const neighborId = edge.from_id === nodeId ? edge.to_id : edge.from_id;
        if (!visited.has(neighborId)) {
          stack.push(neighborId);
        }
      }
    }

    return Array.from(component);
  }

  // Find shortest path between two nodes
  async shortestPath(startNodeId, endNodeId, relationshipFilter = null) {
    const visited = new Set();
    const queue = [{ nodeId: startNodeId, path: [startNodeId], depth: 0 }];
    const paths = {};

    while (queue.length > 0) {
      const { nodeId, path, depth } = queue.shift();

      if (visited.has(nodeId)) {
        continue;
      }

      visited.add(nodeId);
      paths[nodeId] = path;

      if (nodeId === endNodeId) {
        return path;
      }

      // Get neighbors
      const outgoing = await this.graphDB.getEdges(nodeId, null, relationshipFilter);
      const incoming = await this.graphDB.getEdges(null, nodeId, relationshipFilter);

      for (const edge of [...outgoing, ...incoming]) {
        const neighborId = edge.from_id === nodeId ? edge.to_id : edge.from_id;
        if (!visited.has(neighborId)) {
          queue.push({
            nodeId: neighborId,
            path: [...path, neighborId],
            depth: depth + 1
          });
        }
      }
    }

    return null; // No path found
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