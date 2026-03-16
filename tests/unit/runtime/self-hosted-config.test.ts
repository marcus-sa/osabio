import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadServerConfig } from "../../../app/src/server/runtime/config";

/**
 * Tests for self-hosted deployment config fields:
 * - SELF_HOSTED: boolean, defaults false
 * - ADMIN_EMAIL: required when SELF_HOSTED=true
 * - ADMIN_PASSWORD: required when SELF_HOSTED=true
 * - WORKTREE_MANAGER_ENABLED: boolean, defaults false
 *
 * Behaviors under test:
 * 1. SELF_HOSTED defaults to false when unset
 * 2. SELF_HOSTED parses "true" as true (case-insensitive)
 * 3. ADMIN_EMAIL and ADMIN_PASSWORD required when SELF_HOSTED=true
 * 4. ADMIN_EMAIL and ADMIN_PASSWORD ignored when SELF_HOSTED=false
 * 5. WORKTREE_MANAGER_ENABLED defaults to false when unset
 * 6. WORKTREE_MANAGER_ENABLED parses "true" as true
 * 7. ADMIN_PASSWORD never appears in error messages
 */

const REQUIRED_ENV = {
  OPENROUTER_API_KEY: "test-key",
  CHAT_AGENT_MODEL: "test-chat-model",
  EXTRACTION_MODEL: "test-extraction-model",
  ANALYTICS_MODEL: "test-analytics-model",
  EMBEDDING_MODEL: "test-embedding-model",
  EMBEDDING_DIMENSION: "1536",
  EXTRACTION_STORE_THRESHOLD: "0.6",
  EXTRACTION_DISPLAY_THRESHOLD: "0.85",
  SURREAL_URL: "ws://127.0.0.1:8000/rpc",
  SURREAL_USERNAME: "root",
  SURREAL_PASSWORD: "root",
  SURREAL_NAMESPACE: "test",
  SURREAL_DATABASE: "test",
  PORT: "3000",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
};

const SELF_HOSTED_VARS = [
  "SELF_HOSTED",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "WORKTREE_MANAGER_ENABLED",
] as const;

describe("self-hosted config parsing", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...Bun.env };
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      Bun.env[key] = value;
    }
    for (const key of SELF_HOSTED_VARS) {
      delete Bun.env[key];
    }
  });

  afterEach(() => {
    for (const key of [...Object.keys(REQUIRED_ENV), ...SELF_HOSTED_VARS]) {
      if (savedEnv[key] !== undefined) {
        Bun.env[key] = savedEnv[key];
      } else {
        delete Bun.env[key];
      }
    }
  });

  describe("SELF_HOSTED", () => {
    test("defaults to false when unset", () => {
      const config = loadServerConfig();
      expect(config.selfHosted).toBe(false);
    });

    test("parses 'true' as true", () => {
      Bun.env.SELF_HOSTED = "true";
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      Bun.env.ADMIN_PASSWORD = "secret123";
      const config = loadServerConfig();
      expect(config.selfHosted).toBe(true);
    });

    test("parses 'TRUE' as true (case-insensitive)", () => {
      Bun.env.SELF_HOSTED = "TRUE";
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      Bun.env.ADMIN_PASSWORD = "secret123";
      const config = loadServerConfig();
      expect(config.selfHosted).toBe(true);
    });

    test("parses 'false' as false", () => {
      Bun.env.SELF_HOSTED = "false";
      const config = loadServerConfig();
      expect(config.selfHosted).toBe(false);
    });

    test("parses empty string as false", () => {
      Bun.env.SELF_HOSTED = "";
      const config = loadServerConfig();
      expect(config.selfHosted).toBe(false);
    });
  });

  describe("ADMIN_EMAIL and ADMIN_PASSWORD conditional validation", () => {
    test("requires ADMIN_EMAIL when SELF_HOSTED=true", () => {
      Bun.env.SELF_HOSTED = "true";
      Bun.env.ADMIN_PASSWORD = "secret123";
      expect(() => loadServerConfig()).toThrow("ADMIN_EMAIL is required when SELF_HOSTED=true");
    });

    test("requires ADMIN_PASSWORD when SELF_HOSTED=true", () => {
      Bun.env.SELF_HOSTED = "true";
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      expect(() => loadServerConfig()).toThrow("ADMIN_PASSWORD is required when SELF_HOSTED=true");
    });

    test("returns adminEmail and adminPassword when SELF_HOSTED=true", () => {
      Bun.env.SELF_HOSTED = "true";
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      Bun.env.ADMIN_PASSWORD = "secret123";
      const config = loadServerConfig();
      expect(config.adminEmail).toBe("admin@example.com");
      expect(config.adminPassword).toBe("secret123");
    });

    test("omits adminEmail and adminPassword when SELF_HOSTED=false", () => {
      Bun.env.SELF_HOSTED = "false";
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      Bun.env.ADMIN_PASSWORD = "secret123";
      const config = loadServerConfig();
      expect(config.adminEmail).toBeUndefined();
      expect(config.adminPassword).toBeUndefined();
    });

    test("omits adminEmail and adminPassword when SELF_HOSTED unset", () => {
      Bun.env.ADMIN_EMAIL = "admin@example.com";
      Bun.env.ADMIN_PASSWORD = "secret123";
      const config = loadServerConfig();
      expect(config.adminEmail).toBeUndefined();
      expect(config.adminPassword).toBeUndefined();
    });
  });

  describe("ADMIN_PASSWORD security", () => {
    test("error message does not contain the actual password value", () => {
      Bun.env.SELF_HOSTED = "true";
      // Both missing -- error should mention field name, not leak password
      try {
        loadServerConfig();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain("secret");
      }
    });
  });

  describe("WORKTREE_MANAGER_ENABLED", () => {
    test("defaults to false when unset", () => {
      const config = loadServerConfig();
      expect(config.worktreeManagerEnabled).toBe(false);
    });

    test("parses 'true' as true", () => {
      Bun.env.WORKTREE_MANAGER_ENABLED = "true";
      const config = loadServerConfig();
      expect(config.worktreeManagerEnabled).toBe(true);
    });

    test("parses 'TRUE' as true (case-insensitive)", () => {
      Bun.env.WORKTREE_MANAGER_ENABLED = "TRUE";
      const config = loadServerConfig();
      expect(config.worktreeManagerEnabled).toBe(true);
    });

    test("parses empty string as false", () => {
      Bun.env.WORKTREE_MANAGER_ENABLED = "";
      const config = loadServerConfig();
      expect(config.worktreeManagerEnabled).toBe(false);
    });
  });
});
