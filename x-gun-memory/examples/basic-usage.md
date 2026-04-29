# Basic Usage Examples

## Store Memory

Store a memory using the REST API:

```bash
curl -X POST http://localhost:3000/store \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "agentId": "my-agent",
    "type": "conversation",
    "content": "User asked: What is the weather?"
  }'
```

## Retrieve Memory

Retrieve relevant context:

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "http://localhost:3000/retrieve?agentId=my-agent&q=weather&max_nodes=3"
```

## MCP Tool Call

Store via MCP:

```json
{
  "method": "tools/call",
  "params": {
    "name": "store_context",
    "arguments": {
      "agentId": "claude-desktop",
      "type": "code",
      "content": "Fixed the bug in user authentication"
    }
  }
}
```