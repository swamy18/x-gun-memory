# X-Gun Memory + OpenClaw Integration

This guide shows how to connect X-Gun Memory to OpenClaw for persistent multi-agent memory.

## What is OpenClaw?

OpenClaw is an open-source AI agent platform that supports multiple concurrent AI agents with MCP (Model Context Protocol) integration. It allows running multiple AI assistants simultaneously with shared or isolated memory spaces.

## Connecting X-Gun Memory to OpenClaw

X-Gun Memory integrates with OpenClaw via HTTP/SSE (Server-Sent Events) mode, enabling real-time memory sharing across multiple agents.

### Step-by-Step Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure for OpenClaw**
   Copy the provided `config.json` to your project root or use environment variables to override settings.

3. **Start X-Gun Memory in HTTP/SSE Mode**
   ```bash
   npm run start:mcp:http
   ```

   This starts the MCP server on `http://localhost:3001` with SSE support.

4. **Connect in OpenClaw**
   In your OpenClaw configuration, add X-Gun Memory as an MCP connector:
   - **Connector URL**: `http://localhost:3001/sse`
   - **Mode**: HTTP/SSE
   - **Authentication**: Configure API keys in X-Gun Memory's config if needed

5. **Verify Connection**
   Check OpenClaw's logs for successful MCP connection. Your agents should now have persistent memory that survives restarts.

### Configuration Notes

- **Storage**: Uses SQLite by default for local persistence
- **Redis**: Disabled in the example config for simplicity
- **Authentication**: Set to simple key-based auth
- **Ports**: MCP on 3001, API on 3000

### Troubleshooting

- Ensure X-Gun Memory is running before starting OpenClaw
- Check that port 3001 is not in use
- Verify SSE endpoint is accessible: `http://localhost:3001/sse`

For more advanced configurations, see the main README.md.