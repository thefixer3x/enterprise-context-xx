export interface Phase {
  number: number;
  title: string;
  tasks: string[];
}

export const phasedPlan: Phase[] = [
  {
    number: 1,
    title: 'Documentation Consolidation',
    tasks: [
      'Consolidate READMEs into centralized docs/ directory',
      'Archive outdated docs to archive/ folder',
      'Update top-level README references to consolidated docs'
    ]
  },
  {
    number: 2,
    title: 'Secret Management & Validation',
    tasks: [
      'Add startup validation for required environment variables',
      'Integrate secretlint or equivalent to prevent credential leaks'
    ]
  },
  {
    number: 3,
    title: 'CI/CD Security Enhancements',
    tasks: [
      'Pin versions for Trivy, Bun setup, and other GitHub Actions',
      'Add dependency audit step using bun audit or npm audit --audit-level=high',
      'Enforce minimum coverage thresholds in CI'
    ]
  },
  {
    number: 4,
    title: 'Pre-Commit Hooks & Script Linting',
    tasks: [
      'Introduce .pre-commit-config.yaml running ESLint, Prettier, Shellcheck',
      'Lint all deployment and helper scripts with Shellcheck'
    ]
  },
  {
    number: 5,
    title: 'Version Management & Releases',
    tasks: [
      'Lock CI tool versions for Bun, GitHub Actions, and Docker base images',
      'Define uniform release workflow across CLI, SDK, and extensions'
    ]
  },
  {
    number: 6,
    title: 'Coverage Monitoring',
    tasks: [
      'Add Codecov badge to README',
      'Fail CI if coverage drops below agreed minimum'
    ]
  },
  {
    number: 7,
    title: 'AI Orchestrator Enhancement',
    tasks: [
      'Scaffold backend orchestrator service with LLM integration and tooling plugins',
      'Build plugin interface for memory search, external search, code review, and credential management',
      'Implement retrieval-augmented generation with automatic memory creation and recall'
    ]
  },
  {
    number: 8,
    title: 'Dashboard & SDK Integration',
    tasks: [
      'Embed orchestrator service into dashboard with persistent chat panel',
      'Provide enable/disable switch and dynamic API/memory-client configuration loading',
      'Format plugin outputs into human-friendly cards, links, and rich text'
    ]
  },
  {
    number: 9,
    title: 'Credential & MCP Tooling',
    tasks: [
      'Build credential manager UI and backend for API keys, secrets, and rotation',
      'Provide one-click MCP server/client configuration flows for VSCode, Cursor, Windsurf'
    ]
  },
  {
    number: 10,
    title: 'External Context Plugins',
    tasks: [
      'Integrate web-search API to enrich chat context',
      'Enable orchestrator to analyze local codebase for live code review'
    ]
  },
  {
    number: 11,
    title: 'CI/CD in Fragments',
    tasks: [
      'Split CI into workflow fragments per sprint for independent validation and deployment',
      'Add automated build/test/deploy for orchestrator backend',
      'Add dashboard integration end-to-end tests for UI embedding and session persistence',
      'Add verification jobs for each tool/plugin (search, code analysis, credential management)'
    ]
  },
  {
    number: 12,
    title: 'End-to-End Demonstration & Docs',
    tasks: [
      'Publish walkthrough guide for orchestrator flow end-to-end',
      'Provide example projects using the SDK, CLI, and dashboard orchestrator',
      'Tag and release orchestrator and dashboard components as versioned artifacts'
    ]
  }
];

export default phasedPlan;
