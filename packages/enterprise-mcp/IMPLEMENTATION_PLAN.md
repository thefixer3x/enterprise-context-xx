# Enterprise MCP Server - Implementation Plan

**Created**: 2025-01-07
**Repository**: thefixer3x/lan-onasis-monorepo
**Component**: packages/unified-mcp-server → **enterprise-mcp**

## GitHub Issues

| Priority | Issue | Title |
|----------|-------|-------|
| P0 | [#96](https://github.com/thefixer3x/lan-onasis-monorepo/issues/96) | Security Hardening |
| P0 | [#97](https://github.com/thefixer3x/lan-onasis-monorepo/issues/97) | Port Reliability Components from standalone-mcp-submodule |
| P1 | [#98](https://github.com/thefixer3x/lan-onasis-monorepo/issues/98) | Observability - Request Tracking and Metrics |
| P2 | [#99](https://github.com/thefixer3x/lan-onasis-monorepo/issues/99) | Performance - Caching and Circuit Breaker |

---

## Overview

This document outlines the phased implementation plan for hardening the **unified-mcp-server** for enterprise production deployment. The server is architecturally a **thin API wrapper** that delegates to:

- **Supabase REST API** for CRUD operations
- **Edge Functions** (`/apps/onasis-core/supabase/functions/`) for business logic
- **Database RPCs** for vector search and complex queries

---

## Architecture Principle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enterprise Clients                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 unified-mcp-server (Thin Wrapper)               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  Timeouts   │ │   Retry     │ │  Logging    │ │  Circuit  │ │
│  │  (P0)       │ │   (P0)      │ │  (P1)       │ │  Breaker  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│  Supabase REST  │ │ Edge Functions  │ │   Database (pgvector)   │
│  API            │ │ (intelligence,  │ │   RPCs                  │
│                 │ │  memory-search) │ │                         │
└─────────────────┘ └─────────────────┘ └─────────────────────────┘
```

**The MCP server adds reliability (timeouts, retries, logging) but does NOT duplicate backend logic.**

---

## Implementation Strategy: Port, Don't Rewrite

> **Key Decision**: Instead of reimplementing utilities from scratch, we will **port existing code** from `standalone-mcp-submodule` which already has production-ready implementations.

### Files to Port

| Source File | Destination | What It Provides |
|-------------|-------------|------------------|
| `standalone-mcp-submodule/src/utils/logger.ts` | `enterprise-mcp/src/utils/` | Winston structured logging |
| `standalone-mcp-submodule/src/middleware/errorHandler.ts` | `enterprise-mcp/src/middleware/` | Error classes, async handler |
| `standalone-mcp-submodule/src/routes/health.ts` | `enterprise-mcp/src/routes/` | Health, ready, live endpoints |
| `standalone-mcp-submodule/src/services/onasisCoreClient.ts` | Replace `api-client.ts` | Axios with 30s timeout |

### Only New Code Needed

1. **Retry logic** (~30 lines) - Add to axios client
2. **Request ID middleware** (~10 lines) - UUID generation

---

## Phase 0: Security (Immediate)

**Timeline**: Before any deployment
**GitHub Issue**: [#96](https://github.com/thefixer3x/lan-onasis-monorepo/issues/96)

### Tasks

- [ ] **Rotate exposed credentials** in `.env` file
  - Supabase anon key
  - Supabase service role key
  - Regenerate all API keys
- [ ] **Add environment validation** at startup
  ```typescript
  const requiredEnvVars = ['LANONASIS_API_KEY', 'SUPABASE_FUNCTIONS_URL'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required: ${envVar}`);
      process.exit(1);
    }
  }
  ```
- [ ] **Add API key format validation**
- [ ] **Review .gitignore** for sensitive files

### Acceptance Criteria

- No credentials in version control
- Server fails fast on missing config
- API keys validated before use

---

## Phase 1: Reliability Engineering (Week 1-2)

**Timeline**: 1-2 weeks
**GitHub Issue**: [#97](https://github.com/thefixer3x/lan-onasis-monorepo/issues/97)

### 1.1 Request Timeouts

**File**: `src/utils/api-client.ts`

```typescript
private async fetchWithTimeout<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
```

**Acceptance Criteria**:
- All fetch calls use AbortController
- Configurable timeout per request type
- Timeout errors are properly caught and logged

### 1.2 Retry Logic with Exponential Backoff

**File**: `src/utils/api-client.ts`

```typescript
private async fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  config: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 1000 } = config;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await this.fetchWithTimeout(url, options);

      // Retry on 5xx errors or rate limits
      if (response.status >= 500 || response.status === 429) {
        const delay = Math.pow(2, attempt) * baseDelayMs;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Timeout - retry
        const delay = Math.pow(2, attempt) * baseDelayMs;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
```

**Acceptance Criteria**:
- Transient failures (5xx, timeout) automatically retry
- Exponential backoff prevents thundering herd
- Max retries configurable

### 1.3 Rate Limit Handling

**File**: `src/utils/api-client.ts`

```typescript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After') || '60';
  return {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      retryAfter: parseInt(retryAfter),
    },
  };
}
```

**Acceptance Criteria**:
- 429 responses handled gracefully
- Retry-After header respected
- Clear error message to clients

---

## Phase 2: Observability (Week 2-3)

**Timeline**: 1 week
**GitHub Issue**: [#98](https://github.com/thefixer3x/lan-onasis-monorepo/issues/98)

### 2.1 Structured Logging

**New File**: `src/utils/logger.ts`

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'unified-mcp-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Production: add file transports
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}
```

**Acceptance Criteria**:
- JSON-formatted logs in production
- Log levels configurable
- Request/response logging for debugging

### 2.2 Request ID Tracking

**File**: `src/index.ts`

```typescript
import { randomUUID } from 'crypto';

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] as string || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
```

**Acceptance Criteria**:
- Every request has unique ID
- ID passed to downstream services
- ID included in logs

---

## Phase 3: Resilience (Week 3-4)

**Timeline**: 1 week
**GitHub Issue**: [#97](https://github.com/thefixer3x/lan-onasis-monorepo/issues/97) (continued)

### 3.1 Enhanced Health Checks

**File**: `src/index.ts`

```typescript
app.get("/health", async (_req, res) => {
  const checks = {
    api: await checkApiHealth(),
    functions: await checkFunctionsHealth(),
    timestamp: new Date().toISOString(),
  };

  const allHealthy = Object.values(checks)
    .filter(v => typeof v === 'object')
    .every((c: any) => c.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    version: process.env.npm_package_version || '1.0.0',
  });
});
```

**Acceptance Criteria**:
- Health endpoint checks all dependencies
- Returns 503 when degraded
- Includes version info

### 3.2 Error Response Normalization

**File**: `src/utils/errors.ts`

```typescript
export interface NormalizedError {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
  };
}

export function normalizeError(error: unknown, requestId?: string): NormalizedError {
  // Handle different error types consistently
}
```

**Acceptance Criteria**:
- All errors follow same format
- Error codes are documented
- Retryable flag for client retry logic

---

## Phase 4: Performance (Week 4-5)

**Timeline**: 1 week
**GitHub Issue**: [#99](https://github.com/thefixer3x/lan-onasis-monorepo/issues/99)

### 4.1 Response Caching

```typescript
const cache = new Map<string, { data: unknown; expires: number }>();

async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 60000
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }

  const data = await fetcher();
  cache.set(key, { data, expires: Date.now() + ttlMs });
  return data;
}
```

**Acceptance Criteria**:
- Frequently accessed data cached
- TTL configurable per endpoint
- Cache invalidation on mutations

### 4.2 Circuit Breaker (Optional)

For advanced resilience, implement circuit breaker pattern to prevent cascade failures when backend services are unhealthy.

---

## Dependency Summary

| Package | Phase | Purpose |
|---------|-------|---------|
| `winston` | P2 | Structured logging |
| `opossum` | P4 (optional) | Circuit breaker |

---

## Testing Strategy

### Unit Tests
- Mock fetch for timeout/retry testing
- Test error normalization
- Test cache behavior

### Integration Tests
- Health check endpoint
- Full request lifecycle with mocked backend

### Load Tests
- Verify timeout behavior under load
- Test retry logic doesn't amplify failures

---

## Rollout Plan

1. **Development**: Implement Phase 0-1
2. **Staging**: Deploy with monitoring, run load tests
3. **Canary**: 10% of enterprise traffic
4. **Production**: Full rollout with feature flags

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| P99 Latency | < 2s | Monitoring |
| Error Rate | < 0.1% | Logs |
| Availability | 99.9% | Health checks |
| Retry Success | > 80% | Logs |

---

## Related Documents

- `/opt/lanonasis/mcp-monorepo/packages/unified-mcp-server/COMPARISON_REVIEW.md`
- `/opt/lanonasis/lan-onasis-monorepo/apps/mcp-core/CODE_REVIEW.md`
- `/opt/lanonasis/lan-onasis-monorepo/apps/onasis-core/supabase/functions/` (Edge Functions)
