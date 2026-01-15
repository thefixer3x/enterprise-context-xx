#!/usr/bin/env node
/**
 * Lanonasis Enterprise MCP Server
 *
 * A thin MCP wrapper around Supabase REST APIs and Edge Functions.
 * 27 tools across: Memory, Intelligence, API Keys, Projects, Organizations, System
 *
 * Enhanced with:
 * - Structured logging (Winston)
 * - Request ID tracking
 * - Error normalization
 * - Automatic retry with exponential backoff
 * - Configurable timeouts
 *
 * Supports: stdio, HTTP, SSE transports
 */

import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

// Import reliability components
import { config, validateEnvironment } from "./config/environment.js";
import { logger } from "./utils/logger.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { sanitizationMiddleware, maliciousInputDetection } from "./middleware/sanitization.js";
import { initializeApiClient, getApiClient } from "./utils/api-client.js";
import { checkDependencyHealth, getServerMetrics } from "./utils/health.js";
import { generatePrometheusMetrics, getMetricsJson, requestMetrics } from "./utils/metrics.js";
import { circuitBreakerRegistry } from "./utils/circuit-breaker.js";
import { memoryListCache, statsCache } from "./utils/cache.js";
import { chunkContent, createChunkedMemories, needsChunking, estimateChunkCount } from "./utils/content-chunker.js";

// Validate environment on startup
const { warnings } = validateEnvironment();
if (warnings.length > 0) {
  warnings.forEach(w => logger.warn('Environment warning', { message: w }));
}

// Initialize API client with validated config
initializeApiClient({
  baseUrl: config.LANONASIS_API_URL,
  supabaseFunctionsUrl: config.SUPABASE_FUNCTIONS_URL,
  apiKey: config.LANONASIS_API_KEY,
  bearerToken: config.LANONASIS_BEARER_TOKEN,
});

// For resource templates
const apiBaseUrl = config.LANONASIS_API_URL;
const supabaseFunctionsUrl = config.SUPABASE_FUNCTIONS_URL;

// Create MCP Server with full metadata
const server = new McpServer({
  name: "lanonasis-enterprise-mcp",
  version: "1.0.0",
  title: "Lanonasis Memory Intelligence",
  description: "AI-powered memory management with semantic search, intelligent tagging, duplicate detection, pattern analysis, and insights extraction. Manage memories, API keys, projects, and organizations through a unified interface.",
  websiteUrl: "https://lanonasis.com",
  icons: [
    {
      src: "https://lanonasis.com/icons/lanonasis-64.png",
      mimeType: "image/png",
      sizes: ["64x64"],
    },
    {
      src: "https://lanonasis.com/icons/lanonasis-128.png",
      mimeType: "image/png",
      sizes: ["128x128"],
    },
  ],
});

// =============================================================================
// MCP PROMPTS - Common Workflows
// =============================================================================

server.registerPrompt("memory_workflow", {
  title: "Memory Management Workflow",
  description: "Guide for creating, organizing, and searching memories effectively",
  argsSchema: {
    action: z.enum(["create", "search", "organize", "analyze"]).describe("The memory action to perform"),
    context: z.string().optional().describe("Additional context for the workflow"),
  },
}, async (args) => {
  const workflows: Record<string, string> = {
    create: `# Creating a New Memory

1. Use \`create_memory\` with:
   - **title**: A descriptive, searchable title
   - **content**: The full content to store
   - **type**: One of: context, project, knowledge, reference, personal, workflow
   - **tags**: Array of relevant tags for organization

2. After creation, use \`intelligence_suggest_tags\` to get AI-powered tag recommendations

Example:
\`\`\`json
{
  "title": "React Hooks Best Practices",
  "content": "Always use useCallback for...",
  "type": "knowledge",
  "tags": ["react", "hooks", "best-practices"]
}
\`\`\``,
    search: `# Searching Memories

1. **Semantic Search**: Use \`search_memories\` for natural language queries
   - Set \`threshold\` (0-1) to control match strictness
   - Filter by \`type\` for focused results

2. **List with Filters**: Use \`list_memories\` for browsing
   - Filter by tags, type
   - Sort by created_at, updated_at, or title

3. **Find Related**: Use \`intelligence_find_related\` to discover connected memories`,
    organize: `# Organizing Memories

1. **Tag Management**:
   - Use \`intelligence_suggest_tags\` to get AI tag recommendations
   - Update memories with \`update_memory\` to add tags

2. **Duplicate Detection**:
   - Run \`intelligence_detect_duplicates\` periodically
   - Review and merge or delete duplicates

3. **Bulk Operations**:
   - Use \`memory_bulk_delete\` to clean up multiple memories at once`,
    analyze: `# Analyzing Memory Patterns

1. **Extract Insights**: Use \`intelligence_extract_insights\`
   - Filter by topic or memory_type
   - Get actionable summaries from your knowledge base

2. **Pattern Analysis**: Use \`intelligence_analyze_patterns\`
   - Understand your memory usage trends
   - Identify knowledge gaps

3. **Statistics**: Use \`memory_stats\` for usage metrics`,
  };

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: workflows[args.action] + (args.context ? `\n\nContext: ${args.context}` : ""),
        },
      },
    ],
  };
});

server.registerPrompt("api_key_management", {
  title: "API Key Security Guide",
  description: "Best practices for managing API keys securely",
}, async () => ({
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: `# API Key Security Best Practices

## Creating Keys
- Use descriptive names indicating purpose
- Set appropriate access_level (public, authenticated, team, admin, enterprise)
- Set reasonable expiration (expires_in_days)
- Associate with specific projects when possible

## Key Rotation
- Rotate keys regularly with \`rotate_api_key\`
- Update applications before old key expires
- Monitor for unauthorized usage

## Revoking Keys
- Immediately revoke compromised keys with \`revoke_api_key\`
- Use \`delete_api_key\` for permanent removal

## Available Tools
- \`list_api_keys\` - View all your keys
- \`create_api_key\` - Create new key
- \`rotate_api_key\` - Generate new secret
- \`revoke_api_key\` - Deactivate key
- \`delete_api_key\` - Permanently remove`,
      },
    },
  ],
}));

server.registerPrompt("intelligence_guide", {
  title: "Memory Intelligence Features",
  description: "Guide to AI-powered memory analysis capabilities",
}, async () => ({
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: `# Memory Intelligence Features

## Tag Suggestions
\`intelligence_suggest_tags\` - AI analyzes memory content to suggest relevant tags
- Improves organization and discoverability
- Works with any memory type

## Related Memories
\`intelligence_find_related\` - Finds semantically similar memories
- Uses vector embeddings for accurate matching
- Adjust similarity_threshold for precision

## Duplicate Detection
\`intelligence_detect_duplicates\` - Identifies potential duplicates
- Helps clean up redundant information
- Shows similarity scores for review

## Insight Extraction
\`intelligence_extract_insights\` - Summarizes knowledge from memories
- Filter by topic for focused insights
- Great for decision-making support

## Pattern Analysis
\`intelligence_analyze_patterns\` - Analyzes usage trends
- Identifies what you're learning/storing
- Helps optimize knowledge management`,
      },
    },
  ],
}));

// =============================================================================
// MCP RESOURCES - Documentation & Configuration
// =============================================================================

server.registerResource("docs://api-reference", "docs://api-reference", {
  title: "API Reference",
  description: "Complete API documentation for all endpoints",
  mimeType: "text/markdown",
}, async () => ({
  contents: [
    {
      uri: "docs://api-reference",
      mimeType: "text/markdown",
      text: `# Lanonasis API Reference

## Base URL
\`${apiBaseUrl}\`

## Authentication
Use either:
- **API Key**: \`X-API-Key: lms_live_xxx\` header
- **Bearer Token**: \`Authorization: Bearer <jwt>\` header

## Endpoints

### Memories
- \`GET /memories\` - List memories
- \`POST /memories\` - Create memory
- \`GET /memories/:id\` - Get memory
- \`PUT /memories/:id\` - Update memory
- \`DELETE /memories/:id\` - Delete memory
- \`POST /memories/search\` - Semantic search

### API Keys
- \`GET /auth/api-keys\` - List keys
- \`POST /auth/api-keys\` - Create key
- \`DELETE /auth/api-keys/:id\` - Delete key
- \`POST /auth/api-keys/:id/rotate\` - Rotate
- \`POST /auth/api-keys/:id/revoke\` - Revoke

### Projects
- \`GET /projects\` - List projects
- \`POST /projects\` - Create project

### System
- \`GET /health\` - Health check
- \`GET /auth/status\` - Auth status
- \`GET /config\` - Get config
- \`PUT /config\` - Set config

## Edge Functions (Intelligence)
Base: \`${supabaseFunctionsUrl}\`

- \`GET /intelligence-health-check\`
- \`POST /intelligence-suggest-tags\`
- \`POST /intelligence-find-related\`
- \`POST /intelligence-detect-duplicates\`
- \`POST /intelligence-extract-insights\`
- \`POST /intelligence-analyze-patterns\`
- \`GET /memory-stats\`
- \`POST /memory-bulk-delete\``,
    },
  ],
}));

server.registerResource("config://current", "config://current", {
  title: "Current Configuration",
  description: "View current server configuration",
  mimeType: "application/json",
}, async () => ({
  contents: [
    {
      uri: "config://current",
      mimeType: "application/json",
      text: JSON.stringify({
        apiBaseUrl,
        supabaseFunctionsUrl,
        authMethod: config.LANONASIS_API_KEY ? "api_key" : config.LANONASIS_BEARER_TOKEN ? "bearer_token" : "none",
        version: "1.0.0",
        tools: 27,
        prompts: 3,
        resources: 2,
        reliability: {
          timeout: config.REQUEST_TIMEOUT_MS,
          maxRetries: config.MAX_RETRIES,
          retryBaseDelay: config.RETRY_BASE_DELAY_MS
        }
      }, null, 2),
    },
  ],
}));

// =============================================================================
// MEMORY TOOLS (7)
// =============================================================================

const MemoryTypeEnum = z.enum(["context", "project", "knowledge", "reference", "personal", "workflow"]);

server.registerTool(
  "list_memories",
  {
    title: "List Memories",
    description: "List memories with pagination and filters. Returns paginated results sorted by the specified field.",
    inputSchema: z.object({
      limit: z.number().min(1).max(100).default(20).optional().describe("Maximum number of memories to return (1-100)"),
      offset: z.number().min(0).default(0).optional().describe("Number of memories to skip for pagination"),
      type: MemoryTypeEnum.optional().describe("Filter by memory type: context, project, knowledge, reference, personal, workflow"),
      tags: z.string().optional().describe("Comma-separated list of tags to filter by"),
      sortBy: z.enum(["created_at", "updated_at", "title"]).default("updated_at").optional().describe("Field to sort results by"),
      sortOrder: z.enum(["asc", "desc"]).default("desc").optional().describe("Sort direction: ascending or descending"),
    }).strict(),
    annotations: {
      title: "List Memories",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memories.list(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "create_memory",
  {
    title: "Create Memory",
    description: "Create a new memory with automatic vector embedding generation for semantic search. The content is processed to create searchable embeddings.",
    inputSchema: z.object({
      title: z.string().min(1).max(255).describe("Descriptive title for the memory (1-255 characters)"),
      content: z.string().min(1).describe("The full content of the memory to store and embed"),
      type: MemoryTypeEnum.describe("Category: context (conversation), project (work), knowledge (learning), reference (docs), personal, workflow"),
      tags: z.array(z.string()).optional().describe("Array of tags for organization and filtering"),
      metadata: z.record(z.unknown()).optional().describe("Additional key-value metadata to store"),
    }).strict(),
    annotations: {
      title: "Create Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memories.create(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "create_memory_chunked",
  {
    title: "Create Memory (Auto-Chunk Large Content)",
    description: "Create memory entries from large content by automatically splitting into multiple chunks. Each chunk preserves context with overlap and is tagged for reassembly. Use this for documents, long conversations, or any content exceeding 8000 characters.",
    inputSchema: z.object({
      title: z.string().min(1).max(255).describe("Base title for the memory (chunks will have ' (Part N of M)' appended)"),
      content: z.string().min(1).describe("The full content to store - will be automatically split if over 8000 characters"),
      type: MemoryTypeEnum.describe("Category: context (conversation), project (work), knowledge (learning), reference (docs), personal, workflow"),
      tags: z.array(z.string()).optional().describe("Array of tags for organization (chunked memories get additional 'chunked' and 'chunk-N-of-M' tags)"),
      metadata: z.record(z.unknown()).optional().describe("Additional key-value metadata to store"),
      maxChunkSize: z.number().min(1000).max(50000).default(8000).optional().describe("Maximum characters per chunk (default: 8000)"),
      overlapSize: z.number().min(0).max(1000).default(200).optional().describe("Character overlap between chunks for context (default: 200)"),
    }).strict(),
    annotations: {
      title: "Create Chunked Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    const { title, content, type, tags = [], metadata = {}, maxChunkSize = 8000, overlapSize = 200 } = args;

    // Check if chunking is needed
    if (!needsChunking(content, maxChunkSize)) {
      // No chunking needed, create single memory
      const result = await getApiClient().memories.create({ title, content, type, tags, metadata });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            chunked: false,
            totalChunks: 1,
            estimatedChunks: 1,
            result
          }, null, 2)
        }]
      };
    }

    // Create chunked memories
    const chunkedMemories = createChunkedMemories(
      title,
      content,
      type,
      tags,
      metadata,
      { maxChunkSize, overlapSize }
    );

    logger.info('Creating chunked memories', {
      title,
      totalChunks: chunkedMemories.length,
      originalLength: content.length,
    });

    // Create all chunks
    const results = [];
    const errors = [];

    for (const memory of chunkedMemories) {
      try {
        const result = await getApiClient().memories.create(memory);
        results.push({
          title: memory.title,
          success: true,
          data: result
        });
      } catch (error) {
        errors.push({
          title: memory.title,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          chunked: true,
          totalChunks: chunkedMemories.length,
          successful: results.length,
          failed: errors.length,
          originalLength: content.length,
          results,
          errors: errors.length > 0 ? errors : undefined
        }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "get_memory",
  {
    title: "Get Memory",
    description: "Retrieve a specific memory by its unique identifier. Returns full memory details including content, metadata, and timestamps.",
    inputSchema: z.object({
      id: z.string().uuid().describe("Unique UUID identifier of the memory to retrieve"),
    }).strict(),
    annotations: {
      title: "Get Memory",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memories.get(args.id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "update_memory",
  {
    title: "Update Memory",
    description: "Update an existing memory's content, title, type, tags, or metadata. Only provided fields are updated; others remain unchanged.",
    inputSchema: z.object({
      id: z.string().uuid().describe("Unique UUID identifier of the memory to update"),
      title: z.string().min(1).max(255).optional().describe("New title for the memory (1-255 characters)"),
      content: z.string().min(1).optional().describe("New content (will regenerate vector embedding)"),
      type: MemoryTypeEnum.optional().describe("New memory type category"),
      tags: z.array(z.string()).optional().describe("New array of tags (replaces existing tags)"),
      metadata: z.record(z.unknown()).optional().describe("New metadata object (merged with existing)"),
    }).strict(),
    annotations: {
      title: "Update Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const { id, ...data } = args;
    const result = await getApiClient().memories.update(id, data);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "delete_memory",
  {
    title: "Delete Memory",
    description: "Permanently delete a memory by its ID. This action cannot be undone.",
    inputSchema: z.object({
      id: z.string().uuid().describe("Unique UUID identifier of the memory to delete permanently"),
    }).strict(),
    annotations: {
      title: "Delete Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memories.delete(args.id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "search_memories",
  {
    title: "Search Memories",
    description: "Search memories using semantic vector search. Finds memories with similar meaning to the query, not just keyword matches.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Natural language search query for semantic matching"),
      type: MemoryTypeEnum.optional().describe("Filter results to a specific memory type"),
      threshold: z.number().min(0).max(1).default(0.8).optional().describe("Minimum similarity score (0-1, higher = more strict)"),
      limit: z.number().min(1).max(100).default(10).optional().describe("Maximum number of results to return"),
    }).strict(),
    annotations: {
      title: "Search Memories",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memories.search(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "search_lanonasis_docs",
  {
    title: "Search Documentation",
    description: "Search the Lanonasis documentation for guides, API references, and SDK information.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query for documentation"),
      section: z.enum(["all", "api", "guides", "sdks"]).default("all").optional().describe("Documentation section to search: all, api, guides, or sdks"),
      limit: z.number().min(1).max(50).default(10).optional().describe("Maximum number of documentation results"),
    }).strict(),
    annotations: {
      title: "Search Lanonasis Docs",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async (args) => {
    const result = await getApiClient().docs.search(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// API KEY TOOLS (5)
// =============================================================================

server.registerTool(
  "list_api_keys",
  {
    title: "List API Keys",
    description: "List all API keys for the authenticated user. Shows key metadata but not the secret values.",
    inputSchema: z.object({
      active_only: z.boolean().default(true).optional().describe("If true, only return active (non-revoked) keys"),
      project_id: z.string().uuid().optional().describe("Filter keys by project UUID"),
    }).strict(),
    annotations: {
      title: "List API Keys",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().apiKeys.list(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "create_api_key",
  {
    title: "Create API Key",
    description: "Create a new API key for programmatic access. The secret is only shown once upon creation.",
    inputSchema: z.object({
      name: z.string().min(1).max(255).describe("Descriptive name for the API key (e.g., 'Production Server')"),
      description: z.string().optional().describe("Optional description of the key's purpose"),
      access_level: z.enum(["public", "authenticated", "team", "admin", "enterprise"]).default("authenticated").optional().describe("Permission level: public (read-only), authenticated (standard), team, admin, enterprise"),
      expires_in_days: z.number().default(365).optional().describe("Number of days until key expires (default: 365)"),
      project_id: z.string().uuid().optional().describe("Associate key with a specific project"),
    }).strict(),
    annotations: {
      title: "Create API Key",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().apiKeys.create(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "delete_api_key",
  {
    title: "Delete API Key",
    description: "Permanently delete an API key. This cannot be undone. Applications using this key will lose access.",
    inputSchema: z.object({
      key_id: z.string().uuid().describe("UUID of the API key to permanently delete"),
    }).strict(),
    annotations: {
      title: "Delete API Key",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().apiKeys.delete(args.key_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "rotate_api_key",
  {
    title: "Rotate API Key",
    description: "Generate a new secret for an existing API key. The old secret becomes invalid immediately.",
    inputSchema: z.object({
      key_id: z.string().uuid().describe("UUID of the API key to rotate"),
    }).strict(),
    annotations: {
      title: "Rotate API Key",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().apiKeys.rotate(args.key_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "revoke_api_key",
  {
    title: "Revoke API Key",
    description: "Deactivate an API key without deleting it. The key can potentially be reactivated later.",
    inputSchema: z.object({
      key_id: z.string().uuid().describe("UUID of the API key to revoke/deactivate"),
    }).strict(),
    annotations: {
      title: "Revoke API Key",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().apiKeys.revoke(args.key_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// PROJECT TOOLS (2)
// =============================================================================

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List all projects accessible to the user, optionally filtered by organization.",
    inputSchema: z.object({
      organization_id: z.string().uuid().optional().describe("Filter projects by organization UUID"),
    }).strict(),
    annotations: {
      title: "List Projects",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().projects.list(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "create_project",
  {
    title: "Create Project",
    description: "Create a new project for organizing memories and API keys. Projects help separate concerns and manage access.",
    inputSchema: z.object({
      name: z.string().min(1).max(255).describe("Project name (1-255 characters)"),
      description: z.string().optional().describe("Optional description of the project's purpose"),
      organization_id: z.string().uuid().optional().describe("Organization to create the project under"),
    }).strict(),
    annotations: {
      title: "Create Project",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().projects.create(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// ORGANIZATION TOOLS (1)
// =============================================================================

server.registerTool(
  "get_organization_info",
  {
    title: "Get Organization Info",
    description: "Get detailed information about an organization including settings, members count, and usage limits.",
    inputSchema: z.object({
      organization_id: z.string().uuid().describe("UUID of the organization to retrieve"),
    }).strict(),
    annotations: {
      title: "Get Organization Info",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().organizations.get(args.organization_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// SYSTEM TOOLS (4)
// =============================================================================

server.registerTool(
  "get_health_status",
  {
    title: "Get Health Status",
    description: "Get comprehensive system health status including API, database, and service availability.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Get Health Status",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const result = await getApiClient().system.health();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_auth_status",
  {
    title: "Get Auth Status",
    description: "Get current authentication status, user information, and access level.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Get Auth Status",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const result = await getApiClient().system.authStatus();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_config",
  {
    title: "Get Configuration",
    description: "Retrieve a configuration setting by key. Returns the current value and metadata.",
    inputSchema: z.object({
      key: z.string().min(1).describe("Configuration key to retrieve (e.g., 'embedding_model', 'max_memories')"),
    }).strict(),
    annotations: {
      title: "Get Configuration",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().system.getConfig(args.key);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "set_config",
  {
    title: "Set Configuration",
    description: "Update a configuration setting. Some settings may require admin access.",
    inputSchema: z.object({
      key: z.string().min(1).describe("Configuration key to update"),
      value: z.string().describe("New value to set for the configuration key"),
    }).strict(),
    annotations: {
      title: "Set Configuration",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().system.setConfig(args.key, args.value);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// INTELLIGENCE TOOLS (6) - Supabase Edge Functions
// =============================================================================

server.registerTool(
  "intelligence_health_check",
  {
    title: "Intelligence Health Check",
    description: "Check health status and availability of AI intelligence services including embedding and analysis endpoints.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Intelligence Health Check",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const result = await getApiClient().intelligence.healthCheck();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "intelligence_suggest_tags",
  {
    title: "Suggest Tags",
    description: "Get AI-powered tag suggestions for a memory based on its content. Uses natural language understanding to recommend relevant tags.",
    inputSchema: z.object({
      memory_id: z.string().uuid().describe("UUID of the memory to analyze for tag suggestions"),
      user_id: z.string().uuid().describe("UUID of the user who owns the memory"),
      max_suggestions: z.number().min(1).max(20).default(5).optional().describe("Maximum number of tag suggestions to return (1-20)"),
      include_existing_tags: z.boolean().default(true).optional().describe("Whether to consider existing tags when making suggestions"),
    }).strict(),
    annotations: {
      title: "Suggest Tags",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().intelligence.suggestTags(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "intelligence_find_related",
  {
    title: "Find Related Memories",
    description: "Find semantically related memories using vector similarity search. Discovers connections between memories based on meaning.",
    inputSchema: z.object({
      memory_id: z.string().uuid().describe("UUID of the source memory to find related content for"),
      user_id: z.string().uuid().describe("UUID of the user who owns the memories"),
      limit: z.number().min(1).max(50).default(10).optional().describe("Maximum number of related memories to return (1-50)"),
      similarity_threshold: z.number().min(0).max(1).default(0.7).optional().describe("Minimum similarity score (0-1, higher = more similar)"),
    }).strict(),
    annotations: {
      title: "Find Related Memories",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().intelligence.findRelated(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "intelligence_detect_duplicates",
  {
    title: "Detect Duplicate Memories",
    description: "Detect potential duplicate memories using semantic similarity analysis. Helps identify redundant content for cleanup.",
    inputSchema: z.object({
      user_id: z.string().uuid().describe("UUID of the user whose memories to analyze"),
      similarity_threshold: z.number().min(0).max(1).default(0.9).optional().describe("Minimum similarity to consider as duplicate (0-1, higher = stricter)"),
      max_pairs: z.number().min(1).max(100).default(20).optional().describe("Maximum number of duplicate pairs to return"),
    }).strict(),
    annotations: {
      title: "Detect Duplicates",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().intelligence.detectDuplicates(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "intelligence_extract_insights",
  {
    title: "Extract Insights",
    description: "Extract actionable insights and summaries from memories using AI analysis. Great for decision support and knowledge synthesis.",
    inputSchema: z.object({
      user_id: z.string().uuid().describe("UUID of the user whose memories to analyze"),
      topic: z.string().optional().describe("Focus topic to filter and focus insight extraction"),
      memory_type: MemoryTypeEnum.optional().describe("Filter to specific memory type for focused analysis"),
      max_memories: z.number().min(1).max(100).default(50).optional().describe("Maximum number of memories to include in analysis"),
    }).strict(),
    annotations: {
      title: "Extract Insights",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().intelligence.extractInsights(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "intelligence_analyze_patterns",
  {
    title: "Analyze Patterns",
    description: "Analyze usage patterns and trends across memories over time. Identifies what topics you focus on and how usage evolves.",
    inputSchema: z.object({
      user_id: z.string().uuid().describe("UUID of the user whose patterns to analyze"),
      time_range_days: z.number().min(1).max(365).default(30).optional().describe("Number of days to include in pattern analysis (1-365)"),
    }).strict(),
    annotations: {
      title: "Analyze Patterns",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().intelligence.analyzePatterns(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// MEMORY UTILITIES (2) - Supabase Edge Functions
// =============================================================================

server.registerTool(
  "memory_stats",
  {
    title: "Memory Statistics",
    description: "Get comprehensive statistics about memory usage including counts by type, storage used, and activity metrics.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Memory Statistics",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const result = await getApiClient().memoryFunctions.stats();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "memory_bulk_delete",
  {
    title: "Bulk Delete Memories",
    description: "Delete multiple memories at once. This is a destructive operation that cannot be undone.",
    inputSchema: z.object({
      ids: z.array(z.string().uuid()).min(1).max(100).describe("Array of memory UUIDs to delete (1-100 at a time)"),
    }).strict(),
    annotations: {
      title: "Bulk Delete Memories",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    const result = await getApiClient().memoryFunctions.bulkDelete(args.ids);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function runStdio(): Promise<void> {
  logger.info("Starting Lanonasis Enterprise MCP Server via stdio...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Server connected", { tools: 27, prompts: 3, resources: 2 });
}

async function runHTTP(): Promise<void> {
  const app = express();

  // Core middleware stack
  app.use(express.json({ limit: '10mb' }));
  app.use(requestIdMiddleware);
  app.use(sanitizationMiddleware);
  app.use(maliciousInputDetection);

  // Store active SSE transports by session ID
  const sseTransports = new Map<string, StreamableHTTPServerTransport>();

  // Basic health check (fast, for load balancers)
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      server: "lanonasis-enterprise-mcp",
      version: "1.0.0",
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  });

  // Comprehensive health check with dependency status
  app.get("/health/full", async (req, res) => {
    try {
      const dependencyHealth = await checkDependencyHealth();

      const serverMetrics = getServerMetrics();
      const httpStatus = dependencyHealth.overall === 'healthy' ? 200 :
                         dependencyHealth.overall === 'degraded' ? 200 : 503;

      res.status(httpStatus).json({
        status: dependencyHealth.overall,
        server: "lanonasis-enterprise-mcp",
        version: "1.0.0",
        tools: 27,
        prompts: 3,
        resources: 2,
        transports: ["http", "sse"],
        activeSessions: sseTransports.size,
        requestId: req.requestId,
        dependencies: dependencyHealth,
        runtime: serverMetrics,
        config: {
          timeout: config.REQUEST_TIMEOUT_MS,
          maxRetries: config.MAX_RETRIES,
          logLevel: config.LOG_LEVEL,
          environment: config.NODE_ENV,
        },
        circuitBreakers: circuitBreakerRegistry.getAllStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Health check failed', { error: (error as Error).message });
      res.status(503).json({
        status: 'unhealthy',
        error: 'Health check failed',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Prometheus metrics endpoint
  app.get("/metrics", (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(generatePrometheusMetrics());
  });

  // JSON metrics endpoint
  app.get("/health/metrics", (req, res) => {
    res.json({
      ...getMetricsJson(),
      requestId: req.requestId,
    });
  });

  // Cache management endpoint
  app.post("/admin/cache/clear", (req, res) => {
    const { cache } = req.body || {};

    if (cache === 'all' || !cache) {
      memoryListCache.clear();
      statsCache.clear();
      logger.info('All caches cleared', { requestId: req.requestId });
      res.json({ success: true, message: 'All caches cleared' });
    } else {
      const cacheMap: Record<string, typeof memoryListCache> = {
        memoryList: memoryListCache,
        stats: statsCache,
      };

      if (cacheMap[cache]) {
        cacheMap[cache].clear();
        res.json({ success: true, message: `Cache '${cache}' cleared` });
      } else {
        res.status(400).json({ success: false, error: `Unknown cache: ${cache}` });
      }
    }
  });

  // Circuit breaker management endpoint
  app.post("/admin/circuit-breaker/reset", (req, res) => {
    circuitBreakerRegistry.resetAll();
    logger.info('All circuit breakers reset', { requestId: req.requestId });
    res.json({ success: true, message: 'All circuit breakers reset' });
  });

  // =============================================================================
  // OAuth 2.0 & MCP Discovery Endpoints (Required for Claude Desktop, Cursor, etc.)
  // =============================================================================

  // Root endpoint for MCP client discovery and preflight requests
  app.get("/", (_req, res) => {
    res.json({
      name: "lanonasis-enterprise-mcp",
      version: "1.0.0",
      status: "running",
      description: "Lanonasis Enterprise MCP Server - Memory Intelligence with Circuit Breakers",
      endpoints: {
        health: "/health",
        healthFull: "/health/full",
        metrics: "/metrics",
        mcp: "/mcp",
        sse: "/sse",
        serverInfo: "/.well-known/mcp.json",
        oauthMetadata: "/.well-known/oauth-authorization-server",
      },
      transports: ["http", "sse"],
      tools: 28,
      prompts: 3,
      resources: 2,
    });
  });

  // OAuth 2.0 Protected Resource Metadata (RFC 9728)
  // Tells clients which authorization server protects this resource
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    const authBaseUrl = process.env.AUTH_BASE_URL || "https://auth.lanonasis.com";
    res.json({
      resource: process.env.MCP_RESOURCE_URL || "https://mcp.lanonasis.com",
      authorization_servers: [authBaseUrl],
      scopes_supported: ["memories:read", "memories:write", "mcp:connect", "mcp:full", "api:access"],
      bearer_methods_supported: ["header"],
      resource_signing_alg_values_supported: ["RS256"],
      resource_documentation: "https://docs.lanonasis.com/mcp",
    });
  });

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  // Required for MCP clients like Claude Desktop, Windsurf, Cursor
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    const authBaseUrl = process.env.AUTH_BASE_URL || "https://auth.lanonasis.com";
    res.json({
      issuer: authBaseUrl,
      authorization_endpoint: `${authBaseUrl}/oauth/authorize`,
      token_endpoint: `${authBaseUrl}/oauth/token`,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      revocation_endpoint: `${authBaseUrl}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      introspection_endpoint: `${authBaseUrl}/oauth/introspect`,
      registration_endpoint: `${authBaseUrl}/register`,
      scopes_supported: ["memories:read", "memories:write", "mcp:connect", "mcp:full", "api:access"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256", "plain"],
      service_documentation: "https://docs.lanonasis.com/mcp/oauth",
    });
  });

  // Dynamic client registration proxy (RFC 7591)
  app.post("/register", async (req, res) => {
    try {
      const authBaseUrl = process.env.AUTH_BASE_URL || "https://auth.lanonasis.com";
      const response = await fetch(`${authBaseUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      logger.error("Client registration proxy error", { error: (error as Error).message });
      res.status(502).json({
        error: "bad_gateway",
        error_description: "Failed to proxy registration to auth server",
      });
    }
  });

  // MCP Server Card endpoint for Smithery and client discovery
  app.get("/.well-known/mcp-config", (_req, res) => {
    const authBaseUrl = process.env.AUTH_BASE_URL || "https://auth.lanonasis.com";
    res.json({
      name: "lanonasis-enterprise-mcp",
      version: "1.0.0",
      description: "Lanonasis Enterprise MCP - Memory Intelligence with AI-powered analysis, circuit breakers, and reliability patterns",
      vendor: "Lanonasis",
      homepage: "https://lanonasis.com",
      documentation: "https://docs.lanonasis.com",
      server: {
        url: process.env.MCP_SERVER_URL || "https://mcp.lanonasis.com",
        transports: ["http", "sse"],
      },
      authentication: {
        type: "oauth2",
        oauth: {
          authorization_url: `${authBaseUrl}/oauth/authorize`,
          token_url: `${authBaseUrl}/oauth/token`,
          scopes: ["mcp:full", "memories:read", "memories:write", "profile"],
          pkce_required: true,
        },
        fallback: {
          api_key: {
            header: "X-API-Key",
          },
        },
      },
      tools: [
        { name: "list_memories", description: "List memories with pagination and filters" },
        { name: "create_memory", description: "Create a new memory with vector embedding" },
        { name: "create_memory_chunked", description: "Create memory with auto-chunking for large content" },
        { name: "get_memory", description: "Retrieve a specific memory by ID" },
        { name: "update_memory", description: "Update an existing memory" },
        { name: "delete_memory", description: "Delete a memory" },
        { name: "search_memories", description: "Semantic vector search across memories" },
        { name: "search_lanonasis_docs", description: "Search product documentation" },
        { name: "list_api_keys", description: "List API keys" },
        { name: "create_api_key", description: "Create new API key" },
        { name: "delete_api_key", description: "Delete an API key" },
        { name: "rotate_api_key", description: "Rotate API key secret" },
        { name: "revoke_api_key", description: "Revoke an API key" },
        { name: "list_projects", description: "List projects" },
        { name: "create_project", description: "Create a new project" },
        { name: "get_organization_info", description: "Get organization details" },
        { name: "get_health_status", description: "Get system health status" },
        { name: "get_auth_status", description: "Get authentication status" },
        { name: "get_config", description: "Get configuration" },
        { name: "set_config", description: "Set configuration" },
        { name: "intelligence_health_check", description: "Check AI services health" },
        { name: "intelligence_suggest_tags", description: "AI-powered tag suggestions" },
        { name: "intelligence_find_related", description: "Find semantically related memories" },
        { name: "intelligence_detect_duplicates", description: "Detect duplicate memories" },
        { name: "intelligence_extract_insights", description: "Extract insights from memories" },
        { name: "intelligence_analyze_patterns", description: "Analyze memory usage patterns" },
        { name: "memory_stats", description: "Get memory statistics" },
        { name: "memory_bulk_delete", description: "Bulk delete memories" },
      ],
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
      },
    });
  });

  // Server info endpoint with OAuth configuration (alias for .well-known/mcp.json)
  app.get(["/.well-known/mcp.json", "/server-info"], (_req, res) => {
    const authBaseUrl = process.env.AUTH_BASE_URL || "https://auth.lanonasis.com";
    res.json({
      name: "lanonasis-enterprise-mcp",
      version: "1.0.0",
      authentication: {
        type: "oauth2",
        oauth2: {
          enabled: true,
          provider: "lanonasis",
          flows: ["authorization_code"],
          authorization_endpoint: `${authBaseUrl}/oauth/authorize`,
          token_endpoint: `${authBaseUrl}/oauth/token`,
          revoke_endpoint: `${authBaseUrl}/oauth/revoke`,
          scopes: {
            available: ["mcp:full", "mcp:tools", "memories:read", "memories:write", "profile"],
            default: ["mcp:full", "memories:read"],
            recommended: ["mcp:full", "memories:read", "memories:write", "profile"],
          },
          pkce: {
            required: true,
            challenge_methods: ["S256"],
          },
        },
      },
      server: {
        status: "running",
        uptime: process.uptime(),
      },
      tools: {
        total: 28,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // =============================================================================
  // MCP Transport Endpoints
  // =============================================================================

  // MCP HTTP endpoint (stateless JSON request/response)
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // SSE endpoint - GET for establishing SSE stream
  app.get("/sse", async (req, res) => {
    const sessionId = req.query.sessionId as string || crypto.randomUUID();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: false, // Use SSE streaming
    });

    sseTransports.set(sessionId, transport);

    res.on("close", () => {
      transport.close();
      sseTransports.delete(sessionId);
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  // SSE endpoint - POST for sending messages to existing session
  app.post("/sse", async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId || !sseTransports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing sessionId" });
      return;
    }

    const transport = sseTransports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
  });

  // Error handler middleware (must be last)
  app.use(errorHandler);

  const port = config.PORT;
  app.listen(port, () => {
    logger.info(`Lanonasis Enterprise MCP Server running`, {
      port,
      endpoints: {
        http: `POST http://localhost:${port}/mcp`,
        sse: `GET http://localhost:${port}/sse`,
        health: `http://localhost:${port}/health`
      },
      environment: config.NODE_ENV,
      logLevel: config.LOG_LEVEL
    });

    // Warmup edge functions to prevent cold starts
    if (config.WARMUP_INTERVAL_MS > 0) {
      const warmup = async () => {
        try {
          await getApiClient().intelligence.healthCheck();
          await getApiClient().system.health();
          logger.debug('Warmup completed successfully');
        } catch (error) {
          logger.debug('Warmup failed (non-critical)', { error: (error as Error).message });
        }
      };

      // Initial warmup after 5 seconds
      setTimeout(warmup, 5000);

      // Periodic warmup
      setInterval(warmup, config.WARMUP_INTERVAL_MS);
      logger.info('Warmup configured', { interval: `${config.WARMUP_INTERVAL_MS / 1000}s` });
    }
  });
}

// Main entry
const args = process.argv.slice(2);
const mode = args.includes("--http") ? "http" : "stdio";

logger.debug('Starting server', { mode, args });

if (mode === "http") {
  runHTTP().catch((error) => {
    logger.error("Server error", { error: error.message, stack: error.stack });
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    logger.error("Server error", { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

export { server };
