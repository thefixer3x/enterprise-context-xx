# 🎯 IMMEDIATE ACTION ITEMS - MaaS MVP Launch

**Priority Queue for Next 2 Weeks to Production-Ready**

---

## 🔴 CRITICAL BLOCKERS (Must Fix This Week)

### 1. **CLI TypeScript Compilation Errors**
**Severity:** CRITICAL | **Time:** 2-3 hours | **Status:** 🔴 BLOCKED

**Problem:**
```
src/commands/memory.ts - Type mismatches between API responses and CLI expectations
src/commands/topics.ts - Invalid table configuration types
src/index.ts - Help interface usage errors
```

**Root Cause:**
The API service updated response format to:
```typescript
// New format
{ data: { results: MemoryItem[]; total: number; } }

// CLI still expects
{ data: MemoryItem[]; total: number; page: number; }
```

**Solution:**
```bash
# 1. Review API actual response format
cd /app && npm run dev  # Start API on :3000

# 2. Test with curl
curl -X POST http://localhost:3000/api/v1/memories/search \
  -H "Authorization: Bearer token" \
  -d '{"query": "test"}'

# 3. Update CLI type definitions
cd /app/cli/src
# Edit commands/memory.ts, commands/topics.ts, utils/api-client.ts

# 4. Verify compilation
npm run build

# 5. Test CLI commands
npm run dev -- memory search "test"
```

**Validation:**
- [ ] `npm run build` passes in `/app/cli`
- [ ] `memory --help` executes without errors
- [ ] `memory search "test"` returns results

---

### 2. **OrchestratorInterface JSX Syntax Error**
**Severity:** CRITICAL | **Time:** 30 minutes | **Status:** 🔴 BLOCKED

**Problem:**
```
src/components/orchestrator/OrchestratorInterface.tsx(264,6): 
  error TS17008: JSX element 'div' has no corresponding closing tag.

src/components/orchestrator/OrchestratorInterface.tsx(372,1): 
  error TS1381: Unexpected token. Did you mean `{'}'}` or `&rbrace;`?
```

**Solution:**
```bash
cd /app

# 1. Open the file and check JSX structure
code src/components/orchestrator/OrchestratorInterface.tsx

# 2. Look for:
#    - Line 264: Opening <div> without closing </div>
#    - Line 372: Unexpected closing brace

# 3. Fix and verify
npm run build  # From root - should fail until fixed

# 4. Alternative: Temporarily disable orchestrator if time-critical
#    (Wrap component in conditional export)
```

**Quick Fix Pattern:**
```typescript
// If syntax is too complex to fix quickly:
export const OrchestratorInterface = () => {
  return null; // Disable for now, enable after MVP
};
```

**Validation:**
- [ ] `npm run build` in root passes
- [ ] `npm run build` in `/app/dashboard` passes

---

### 3. **Missing MCP Server Dependency**
**Severity:** CRITICAL | **Time:** 1-2 hours | **Status:** 🔴 BLOCKED

**Problem:**
```
Error: Cannot find module 'onasis-gateway/mcp-server/server.js'
CLI local MCP mode won't work
```

**Solution Options:**

**Option A: Create Standalone MCP Server (Recommended)**
```bash
# Create new route in main API
cd /app/src/routes
cat > mcp-server.ts << 'EOF'
// MCP Server endpoint for local CLI connections
import { Router } from 'express';

export const mcpRouter = Router();

// POST /mcp/initialize - MCP protocol initialization
mcpRouter.post('/initialize', (req, res) => {
  res.json({
    protocolVersion: '1.0',
    capabilities: {
      resources: true,
      tools: true
    }
  });
});

// WebSocket handler for persistent connections
mcpRouter.ws('/stream', (ws, req) => {
  // Handle MCP message streaming
});
EOF
```

Then update CLI to use `http://localhost:3000/mcp` instead of gateway.

**Option B: Use Local Environment Variable**
```bash
# In cli/src/utils/mcp-client.ts
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 
  (process.env.NODE_ENV === 'development' 
    ? 'http://localhost:3000/mcp'
    : 'https://api.lanonasis.com/mcp');
```

**Validation:**
- [ ] `memory mcp start` starts without error
- [ ] `memory mcp list-tools` returns available tools
- [ ] Local MCP client connects successfully

---

### 4. **npm audit Security Vulnerabilities**
**Severity:** HIGH | **Time:** 30 minutes | **Status:** 🟠 NEEDS DECISION

**Current Issues:**
```
CRITICAL: path-to-regexp CVSS 7.5
HIGH:     esbuild (dev dependency)
MODERATE: undici (2 issues)
```

**Solution:**
```bash
cd /app

# 1. Review what will break
npm audit --json | jq '.vulnerabilities'

# 2. Fix with force (breaking changes expected)
npm audit fix --force

# 3. Test thoroughly
npm run build
npm run test
docker build -t test .

# 4. If breaks, revert:
git checkout package-lock.json
npm ci
```

**Decision Point:**
- If tests pass after `npm audit fix --force`: ✅ Deploy fix
- If tests fail: Evaluate security risk vs functionality risk
- Option: Accept vulnerability for MVP, patch in v1.1

**Validation:**
- [ ] `npm audit` reports 0 vulnerabilities OR
- [ ] Breaking changes reviewed and accepted
- [ ] Build pipeline still works

---

## 🟠 HIGH PRIORITY (Complete This Week)

### 5. **Add Core API Integration Tests**
**Time:** 1-2 days | **Status:** 🟡 NOT STARTED

**Create test file:** `/app/tests/integration/api.test.ts`

```typescript
import supertest from 'supertest';
import app from '../src/server';

const request = supertest(app);

describe('Memory API Integration Tests', () => {
  // Setup: Create test memory
  let testMemoryId: string;

  test('POST /api/v1/memories - Create memory', async () => {
    const response = await request
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        title: 'Test Memory',
        content: 'Test content',
        memory_type: 'knowledge'
      })
      .expect(201);

    expect(response.body.data.id).toBeDefined();
    testMemoryId = response.body.data.id;
  });

  test('GET /api/v1/memories/:id - Retrieve memory', async () => {
    const response = await request
      .get(`/api/v1/memories/${testMemoryId}`)
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .expect(200);

    expect(response.body.data.title).toBe('Test Memory');
  });

  test('PUT /api/v1/memories/:id - Update memory', async () => {
    const response = await request
      .put(`/api/v1/memories/${testMemoryId}`)
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ title: 'Updated Title' })
      .expect(200);

    expect(response.body.data.title).toBe('Updated Title');
  });

  test('POST /api/v1/memories/search - Search memories', async () => {
    const response = await request
      .post('/api/v1/memories/search')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ query: 'test' })
      .expect(200);

    expect(response.body.data.results).toBeInstanceOf(Array);
  });

  test('DELETE /api/v1/memories/:id - Delete memory', async () => {
    const response = await request
      .delete(`/api/v1/memories/${testMemoryId}`)
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('GET /api/v1/health - Health check', async () => {
    const response = await request
      .get('/api/v1/health')
      .expect(200);

    expect(response.body.status).toBe('healthy');
  });
});
```

**Validation:**
- [ ] All integration tests pass
- [ ] Test coverage for /api/v1 routes >80%
- [ ] Tests can run in CI/CD pipeline

---

### 6. **Configure DNS Records**
**Time:** 30 minutes | **Status:** 🟡 MANUAL STEP

**Required DNS Changes:**
```dns
# Contact your domain registrar and add these CNAME records:

Type: CNAME
Name: dashboard
Value: onasis-maas.netlify.app
TTL: 3600

Type: CNAME
Name: docs
Value: lanonasis-docs.netlify.app
TTL: 3600

Type: CNAME
Name: mcp
Value: lanonasis-mcp.netlify.app
TTL: 3600

Type: CNAME
Name: api
Value: onasis-gateway.netlify.app
TTL: 3600 (if not using separate API host)
```

**Verification:**
```bash
# After 10 minutes (DNS propagation)
nslookup dashboard.lanonasis.com
nslookup docs.lanonasis.com
nslookup mcp.lanonasis.com

# Should resolve to Netlify IP
# Expected: CNAME pointing to netlify.app
```

**Validation:**
- [ ] All 4 domains resolve correctly
- [ ] HTTPS certificates auto-provisioned (check Netlify dashboard)
- [ ] Each subdomain loads the correct site

---

### 7. **Enable Test Coverage Thresholds**
**Time:** 1 hour | **Status:** 🟡 CONFIGURATION

**File:** `/app/jest.config.js`

```javascript
// Uncomment coverage thresholds section:
coverageThreshold: {
  global: {
    branches: 60,        // Start conservative
    functions: 60,
    lines: 60,
    statements: 60
  },
  // Project-specific thresholds can be stricter
  './src/services/': {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

**Run coverage:**
```bash
npm run test:coverage

# View HTML report
open coverage/index.html
```

**Validation:**
- [ ] Coverage report generated
- [ ] Threshold enforcement works (test fails if below threshold)
- [ ] Team agrees on targets

---

## 🟡 MEDIUM PRIORITY (Complete Before Production)

### 8. **Add Pre-commit Hooks**
**Time:** 1 hour | **Status:** ⏳ SETUP

**Create:** `/app/.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files

  - repo: https://github.com/eslint/eslint
    rev: v9.17.0
    hooks:
      - id: eslint
        files: \.(ts|tsx|js)$
        types: [file]

  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v3.0.0
    hooks:
      - id: prettier
        files: \.(ts|tsx|js|json|md)$

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: detect-private-key
```

**Setup:**
```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files  # Test it
```

**Validation:**
- [ ] Hooks run before each commit
- [ ] Developers can't commit failing code
- [ ] CI replicates same checks

---

### 9. **End-to-End Workflow Testing**
**Time:** 1 day | **Status:** ⏳ MANUAL TEST

**Test Scenarios:**

**Scenario 1: New User Signup & First Memory**
```
1. Visit dashboard.lanonasis.com
2. Sign up with email
3. Verify email
4. Create first memory
5. Search for memory
6. Verify real-time updates work
✅ Expected: Complete flow takes <5 minutes
```

**Scenario 2: API Key Generation & CLI Usage**
```
1. Login to dashboard
2. Generate API key in settings
3. Copy key to .env
4. Run: memory search "test query"
5. Run: memory create -t "Title" -c "Content"
✅ Expected: CLI works seamlessly
```

**Scenario 3: IDE Extension Integration**
```
1. Install VSCode extension v1.2.0
2. Configure API key in VSCode settings
3. Press Ctrl+Shift+M to search memories
4. Create memory from selected code (Ctrl+Shift+Alt+M)
5. Verify memory appears in dashboard
✅ Expected: Real-time sync works
```

**Scenario 4: Real-time Sync**
```
1. Open dashboard in 2 browser windows
2. Create memory in window A
3. Verify appears instantly in window B
✅ Expected: <1 second propagation
```

**Documentation:**
Create `/app/TESTING_CHECKLIST.md` with all scenarios

**Validation:**
- [ ] All 4 scenarios pass
- [ ] No errors in browser console
- [ ] No errors in server logs
- [ ] Performance acceptable

---

### 10. **Consolidate Documentation**
**Time:** 4-6 hours | **Status:** ⏳ NOT STARTED

**Create documentation structure:**
```
docs/
├── README.md                 # Documentation hub
├── quick-start.md           # 5-minute setup
├── architecture/
│   ├── overview.md
│   ├── data-model.md
│   └── security.md
├── api/
│   ├── rest-api.md          # REST endpoints
│   ├── authentication.md
│   └── error-handling.md
├── sdk/
│   ├── javascript.md
│   ├── react-hooks.md
│   └── examples.md
├── cli/
│   ├── installation.md
│   ├── commands.md
│   └── mcp-mode.md
├── deployment/
│   ├── docker.md
│   ├── kubernetes.md
│   └── production.md
├── extensions/
│   ├── vscode.md
│   ├── cursor.md
│   └── windsurf.md
├── troubleshooting.md
└── faq.md
```

**Migration:**
```bash
# 1. Copy valuable content from existing 47 files into structure above
# 2. Delete old files or archive to /docs/archive/
# 3. Update all cross-references
# 4. Update root README.md to link to /docs/README.md
```

**Validation:**
- [ ] All old docs content preserved
- [ ] No broken links
- [ ] Navigation between sections works
- [ ] Search functionality added (if using VitePress)

---

## ✅ VALIDATION CHECKLIST

### Before Marking "Ready for MVP"

```
CRITICAL ISSUES RESOLVED
☐ CLI compilation errors fixed
☐ MCP server dependency resolved  
☐ OrchestratorInterface JSX fixed
☐ npm audit vulnerabilities fixed
☐ Root level `npm run build` passes
☐ Docker build succeeds

TESTING COMPLETE
☐ Integration tests pass (>80% API coverage)
☐ Unit tests pass
☐ Coverage thresholds enabled and met (≥60%)
☐ All 4 E2E scenarios pass
☐ CLI `memory` command works end-to-end
☐ Extensions load and function

DEPLOYMENT READY
☐ DNS records configured and resolving
☐ All 4 domains (api, dashboard, docs, mcp) accessible
☐ SSL certificates active on all domains
☐ Health check endpoints return 200
☐ Swagger UI accessible at /docs
☐ Dashboard loads without errors
☐ No console errors in production build

SECURITY VERIFIED
☐ npm audit shows 0 vulnerabilities
☐ HTTPS enforced on all domains
☐ API key encryption verified
☐ Authentication flows tested
☐ Rate limiting verified working

DOCUMENTATION COMPLETE
☐ Quick-start guide updated
☐ API documentation generated
☐ CLI help text accurate
☐ Extension setup guides written
☐ No dead links in documentation
☐ Troubleshooting section populated

MONITORING ACTIVE
☐ Prometheus scraping configured
☐ Error logging working
☐ Performance metrics baseline established
☐ Health checks running
☐ Alerts configured
```

---

## 📋 TRACKING & METRICS

### Progress Tracking
```
Week 1:
- Mon: Fix CLI errors, JSX error, audit vulnerabilities ✅
- Tue: Test fixes, verify build pipeline ✅
- Wed: Add integration tests ✅
- Thu: Setup pre-commit hooks ✅
- Fri: Integration tests passing ✅

Week 2:
- Mon: Configure DNS, enable thresholds ✅
- Tue: E2E scenario testing ✅
- Wed: Documentation consolidation ✅
- Thu: Security audit ✅
- Fri: Production validation ✅

Week 3:
- Full end-to-end production deployment
- Performance/load testing
- Go-live readiness review
```

### Success Metrics
- **Build Success Rate**: 100% (currently failing)
- **Test Coverage**: ≥70% (currently ~15%)
- **Critical Vulnerabilities**: 0 (currently 2)
- **Integration Test Pass Rate**: 100%
- **E2E Scenario Pass Rate**: 100%
- **DNS Resolution**: 4/4 domains (currently 0/4)

---

## 🆘 ESCALATION PATHS

### If CLI Can't Be Fixed
**Fallback:** Temporarily disable CLI for MVP v1.0
```typescript
// cli/src/index.ts - Fallback implementation
console.log('CLI coming in v1.1');
process.exit(0);
```
Launch SDK + Dashboard + Extensions first, add CLI after.

### If Security Vulnerabilities Block
**Fallback:** Accept vulnerabilities with mitigation plan
```
Risk: Medium (dev dependencies)
Mitigation: Plan security patch for v1.1
Timeline: 2 weeks after launch
```

### If Tests Can't Reach 70% Coverage
**Fallback:** Set threshold to 50% for MVP
```
Commitment: Increase to 70% for v1.1
Timeline: 1 month after launch
```

---

## 📞 COMMUNICATION TEMPLATE

### Daily Standup Update
```
MVP Status: [BLOCKED | AT RISK | ON TRACK | COMPLETE]

Completed Today:
- [Item 1]
- [Item 2]

Blockers:
- [Critical Issue]: [Status] [Next Action]

Today's Plan:
- [Task 1]
- [Task 2]

Metrics:
- Build Success: X/10
- Test Pass Rate: Y%
```

---

**Last Updated:** November 6, 2025  
**Owner:** Development Team  
**Review Frequency:** Daily (Sprint)  
**Escalation Contact:** [Team Lead]

