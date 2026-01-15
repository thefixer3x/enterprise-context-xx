# Lanonasis Enterprise MCP Server

A robust MCP wrapper around Lanonasis Supabase REST APIs and Edge Functions. 28 tools, 3 prompts, and 2 resources for Memory, Intelligence, API Keys, Projects, Organizations, and System management.

## Architecture

```
Claude/Cursor → MCP Protocol → Enterprise MCP Server → REST API / Edge Functions → Supabase
```

The MCP server is a **thin protocol adapter** with enterprise reliability features - all business logic lives in Supabase.

## Enterprise Features

- **Circuit Breaker Pattern** - Prevents cascade failures (5 failures → 30s cooldown → gradual recovery)
- **LRU Response Caching** - In-memory caching with configurable TTL for frequently accessed data
- **Prometheus Metrics** - Full observability at `/metrics` endpoint
- **Input Sanitization** - XSS, command injection, and malicious input protection
- **Content Chunking** - Automatic splitting of large content into multiple memory entries
- **Dependency Health Checks** - Real-time monitoring of API and Edge Function availability
- **Structured Logging** - Winston-based logging with request ID tracking
- **Automatic Retry** - Exponential backoff for transient failures

## Tools (28 total)

### Memory (8)
- `list_memories` - List with pagination and filters
- `create_memory` - Create with vector embedding
- `create_memory_chunked` - Create with auto-chunking for large content (NEW)
- `get_memory` - Get by ID
- `update_memory` - Update existing
- `delete_memory` - Delete by ID
- `search_memories` - Semantic vector search
- `search_lanonasis_docs` - Search documentation

### Intelligence (6) - AI-Powered Analysis
- `intelligence_health_check` - Check intelligence service status
- `intelligence_suggest_tags` - AI-powered tag suggestions for memories
- `intelligence_find_related` - Find semantically related memories
- `intelligence_detect_duplicates` - Detect potential duplicate memories
- `intelligence_extract_insights` - Extract actionable insights from memories
- `intelligence_analyze_patterns` - Analyze usage patterns and trends

### Memory Utilities (2)
- `memory_stats` - Get memory usage statistics
- `memory_bulk_delete` - Delete multiple memories at once

### API Keys (5)
- `list_api_keys` - List user's keys
- `create_api_key` - Create new key
- `delete_api_key` - Delete permanently
- `rotate_api_key` - Rotate secret
- `revoke_api_key` - Deactivate

### Projects (2)
- `list_projects` - List org projects
- `create_project` - Create project

### Organizations (1)
- `get_organization_info` - Get org details

### System (4)
- `get_health_status` - System health
- `get_auth_status` - Auth status
- `get_config` - Get config
- `set_config` - Set config

## Prompts (3)

Interactive workflow guides for common operations:

- `memory_workflow` - Guided memory management (create, search, organize, analyze)
- `api_key_management` - API key security best practices
- `intelligence_guide` - AI-powered memory analysis features

## Resources (2)

- `docs://api-reference` - Complete API documentation
- `config://current` - Current server configuration

## Quick Start

```bash
# Install
bun install

# Configure
cp .env.example .env
# Edit .env with your API key

# Build
bun run build

# Run stdio mode (for Claude Desktop)
bun run start:stdio

# Run HTTP mode (for web/API access)
bun run start:http
```

## HTTP Endpoints

When running with `--http`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Basic health check |
| `/health/full` | GET | Full health with dependency status |
| `/metrics` | GET | Prometheus metrics |
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/sse` | GET | Server-Sent Events stream |
| `/admin/cache/clear` | POST | Clear response cache |
| `/admin/circuit-breaker/reset` | POST | Reset circuit breakers |

## Claude Desktop Config

```json
{
  "mcpServers": {
    "lanonasis-enterprise": {
      "command": "node",
      "args": ["/path/to/enterprise-mcp/dist/index.js"],
      "env": {
        "LANONASIS_API_KEY": "your_api_key"
      }
    }
  }
}
```

## PM2 Deployment

```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# Monitor
pm2 logs enterprise-mcp

# Check status
pm2 status
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LANONASIS_API_KEY` | API key for authentication | Required |
| `LANONASIS_API_URL` | REST API base URL | `https://api.lanonasis.com/api/v1` |
| `SUPABASE_FUNCTIONS_URL` | Edge Functions URL | Required |
| `PORT` | HTTP server port | `3010` |
| `REQUEST_TIMEOUT_MS` | Request timeout | `30000` |
| `MAX_RETRIES` | Max retry attempts | `3` |
| `WARMUP_INTERVAL_MS` | Edge Function warmup interval | `300000` |

## License

MIT
