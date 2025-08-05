# Phase 9 Implementation: Secure Credential & Secret Manager

This document outlines the concrete steps to deliver a multi-functional secret manager as part of Phase 9.

## 1. Backend Secret Manager Service
- Create `src/services/secretService.ts` implementing:
  ```ts
  import { createClient } from '@supabase/supabase-js';

  export class SecretService {
    private supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    async storeSecret(key: string, value: string): Promise<void> {
      await this.supabase.from('secrets').upsert({ key, value });
    }

    async getSecret(key: string): Promise<string | null> {
      const { data } = await this.supabase
        .from('secrets')
        .select('value')
        .eq('key', key)
        .single();
      return data?.value || null;
    }
  }
  ```

## 2. REST API Endpoints
- Add `src/routes/api-secrets.ts` (protected routes) to expose:
  - `POST /api/v1/secrets` → upsert a secret
  - `GET /api/v1/secrets/:key` → retrieve a secret

## 3. SDK Integration
- Extend `@lanonasis/memory-client` to export:
  ```ts
  export interface SecretManagerClientConfig {
    apiUrl: string;
    apiKey?: string;
  }

  export class SecretManagerClient {
    constructor(private config: SecretManagerClientConfig) {}
    async setSecret(key: string, value: string): Promise<void> { /* ... */ }
    async getSecret(key: string): Promise<string | null> { /* ... */ }
  }
  ```

## 4. CLI Extension
- Add `secret` commands to the CLI (`cli/commands/secret.ts`):
  ```bash
  # lanonasis secret set KEY VALUE
  # lanonasis secret get KEY
  ```

## 5. Dashboard Interface
- Incorporate a Secrets panel in the dashboard UI under Settings:
  - Secure input form to store a new secret
  - Table listing existing keys (hide values until requested)

## 6. IDE Extensions & MCP
- Update VSCode/Cursor/Windsurf extension settings to accept the master API key and optionally preview secrets via MCP tool calls.

## 7. Publishing & Release
- **REST API**: Version bump and release on `main` → deployment pipeline.
- **SDK**: Publish new version to npm (`@lanonasis/memory-client`) including SecretManagerClient.
- **CLI**: Publish updated `@lanonasis/cli` to npm.
- **IDE Exts**: Publish new extension versions to marketplace stores.
- **MCP Tooling**: Release updated MCP tools package.

## 8. Validation & Security
- Write unit tests for `SecretService` and API routes.
- Add CI jobs (Phase 11) to lint and test the secret-manager packages.

---
_Next step: implement the `secretService.ts` and API routes according to this roadmap._
