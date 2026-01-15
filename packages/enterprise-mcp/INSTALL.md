# Enterprise MCP Server - Installation Guide

**Version**: 1.0.0 (Enterprise)
**Date**: 2026-01-07

---

## Quick Start

### 1. Build the Server

```bash
cd /opt/lanonasis/mcp-monorepo/packages/enterprise-mcp
bun install
bun run build
```

### 2. Configure Environment

Create a `.env` file or set environment variables:

```bash
# Required - Authentication (at least one)
LANONASIS_API_KEY=your_api_key_here
# OR
LANONASIS_BEARER_TOKEN=your_jwt_token

# Required - Supabase Edge Functions
SUPABASE_FUNCTIONS_URL=https://mxtsdgkwzjzlttpotole.supabase.co/functions/v1

# Optional - Endpoints (defaults shown)
LANONASIS_API_URL=https://api.lanonasis.com/api/v1

# Optional - Server config
PORT=3010
REQUEST_TIMEOUT_MS=30000
MAX_RETRIES=3
WARMUP_INTERVAL_MS=300000
```

### 3. Run the Server

**stdio mode** (for Claude Desktop):
```bash
node dist/index.js
# or
bun run start:stdio
```

**HTTP mode** (for web clients):
```bash
node dist/index.js --http
# or
bun run start:http
```

---

## Claude Desktop Configuration

### Option A: Copy Config File

Copy `claude_desktop_config.json` to your Claude Desktop config location:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Option B: Manual Configuration

Add this to your existing `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lanonasis-enterprise": {
      "command": "node",
      "args": [
        "/opt/lanonasis/mcp-monorepo/packages/enterprise-mcp/dist/index.js"
      ],
      "env": {
        "LANONASIS_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### Option C: Using npx (if published to npm)

```json
{
  "mcpServers": {
    "lanonasis-enterprise": {
      "command": "npx",
      "args": ["-y", "@lanonasis/enterprise-mcp"],
      "env": {
        "LANONASIS_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

---

## PM2 Deployment (HTTP Mode)

For production HTTP deployment:

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 config
pm2 save

# Setup startup script
pm2 startup
```

### Monitor the Server

```bash
# View logs
pm2 logs enterprise-mcp

# Check status
pm2 status

# Restart
pm2 restart enterprise-mcp
```

---

## Verification

### Test stdio mode:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### Test HTTP mode:
```bash
# Start server
node dist/index.js --http &

# Test basic health
curl http://localhost:3010/health

# Test full health with dependencies
curl http://localhost:3010/health/full

# Test metrics
curl http://localhost:3010/metrics

# Test MCP
curl -X POST http://localhost:3010/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Enterprise Features

### Circuit Breaker
Automatically opens after 5 consecutive failures, preventing cascade failures:
- **CLOSED**: Normal operation
- **OPEN**: Requests fail-fast for 30 seconds
- **HALF_OPEN**: Test requests to check recovery

Reset manually: `POST /admin/circuit-breaker/reset`

### Response Caching
LRU cache for frequently accessed data:
- Configurable TTL per cache type
- Automatic cleanup of expired entries

Clear cache: `POST /admin/cache/clear`

### Prometheus Metrics
Available at `/metrics`:
- Request counts and latencies (p50/p95/p99)
- Circuit breaker states
- Cache hit/miss rates
- Memory and uptime stats

### Content Chunking
The `create_memory_chunked` tool automatically splits large content:
- Default chunk size: 8000 characters
- Overlap: 200 characters for context preservation
- Intelligent boundary detection (paragraphs → sentences → words)

---

## Available Tools (28)

### Memory (8)
- `list_memories` - List with pagination
- `create_memory` - Create with embeddings
- `create_memory_chunked` - Create with auto-chunking
- `get_memory` - Get by ID
- `update_memory` - Update fields
- `delete_memory` - Delete permanently
- `search_memories` - Semantic search
- `search_lanonasis_docs` - Search documentation

### API Keys (5)
- `list_api_keys` - List all keys
- `create_api_key` - Create new key
- `delete_api_key` - Delete permanently
- `rotate_api_key` - Rotate secret
- `revoke_api_key` - Deactivate key

### Projects (2)
- `list_projects` - List all projects
- `create_project` - Create project

### Organization (1)
- `get_organization_info` - Get org details

### System (4)
- `get_health_status` - Health check
- `get_auth_status` - Auth status
- `get_config` - Get config value
- `set_config` - Set config value

### Intelligence (6)
- `intelligence_health_check` - AI service health
- `intelligence_suggest_tags` - Tag suggestions
- `intelligence_find_related` - Find related memories
- `intelligence_detect_duplicates` - Duplicate detection
- `intelligence_extract_insights` - Extract insights
- `intelligence_analyze_patterns` - Pattern analysis

### Memory Utilities (2)
- `memory_stats` - Usage statistics
- `memory_bulk_delete` - Bulk delete

---

## Troubleshooting

### Health Check Shows "Degraded"
1. Check API key is valid in `.env`
2. Verify Edge Functions URL is correct
3. Check network connectivity to Supabase

### Edge Functions Timeout
Edge Functions may have cold starts of 3-5 seconds. The default timeout is 10 seconds to accommodate this.

### Circuit Breaker Open
If you see "Circuit breaker is open", wait 30 seconds or reset manually:
```bash
curl -X POST http://localhost:3010/admin/circuit-breaker/reset
```
