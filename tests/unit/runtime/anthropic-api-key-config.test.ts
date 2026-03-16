import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadServerConfig } from "../../../app/src/server/runtime/config";

/**
 * Tests for ANTHROPIC_API_KEY env var parsing.
 *
 * Behaviors under test:
 * 1. When ANTHROPIC_API_KEY is set, anthropicApiKey appears in ServerConfig
 * 2. When ANTHROPIC_API_KEY is unset, anthropicApiKey is undefined
 * 3. When ANTHROPIC_API_KEY is whitespace-only, anthropicApiKey is undefined
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

describe("ANTHROPIC_API_KEY config parsing", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...Bun.env };
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      Bun.env[key] = value;
    }
    delete Bun.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      if (savedEnv[key] !== undefined) {
        Bun.env[key] = savedEnv[key];
      } else {
        delete Bun.env[key];
      }
    }
    if (savedEnv.ANTHROPIC_API_KEY !== undefined) {
      Bun.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    } else {
      delete Bun.env.ANTHROPIC_API_KEY;
    }
  });

  test("includes anthropicApiKey when ANTHROPIC_API_KEY is set", () => {
    Bun.env.ANTHROPIC_API_KEY = "sk-ant-test-key-123";
    const config = loadServerConfig();
    expect(config.anthropicApiKey).toBe("sk-ant-test-key-123");
  });

  test("anthropicApiKey is undefined when ANTHROPIC_API_KEY is unset", () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    const config = loadServerConfig();
    expect(config.anthropicApiKey).toBeUndefined();
  });

  test("anthropicApiKey is undefined when ANTHROPIC_API_KEY is whitespace", () => {
    Bun.env.ANTHROPIC_API_KEY = "   ";
    const config = loadServerConfig();
    expect(config.anthropicApiKey).toBeUndefined();
  });
});
