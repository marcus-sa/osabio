import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadServerConfig } from "../../../app/src/server/runtime/config";

/**
 * Tests for OBSERVER_MODEL optional env var parsing.
 *
 * Behaviors under test:
 * 1. When OBSERVER_MODEL is set, observerModelId appears in config
 * 2. When OBSERVER_MODEL is unset, observerModelId is undefined
 * 3. When OBSERVER_MODEL is whitespace-only, observerModelId is undefined
 */

const REQUIRED_ENV = {
  OPENROUTER_API_KEY: "test-key",
  CHAT_AGENT_MODEL: "test-chat-model",
  EXTRACTION_MODEL: "test-extraction-model",
  ANALYTICS_MODEL: "test-analytics-model",
  OPENROUTER_EMBEDDING_MODEL: "test-embedding-model",
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

describe("OBSERVER_MODEL config parsing", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...Bun.env };
    // Set all required env vars
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      Bun.env[key] = value;
    }
    // Ensure observer model is clean
    delete Bun.env.OBSERVER_MODEL;
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(REQUIRED_ENV)) {
      if (savedEnv[key] !== undefined) {
        Bun.env[key] = savedEnv[key];
      } else {
        delete Bun.env[key];
      }
    }
    if (savedEnv.OBSERVER_MODEL !== undefined) {
      Bun.env.OBSERVER_MODEL = savedEnv.OBSERVER_MODEL;
    } else {
      delete Bun.env.OBSERVER_MODEL;
    }
  });

  test("includes observerModelId when OBSERVER_MODEL is set", () => {
    Bun.env.OBSERVER_MODEL = "anthropic/claude-3-haiku";
    const config = loadServerConfig();
    expect(config.observerModelId).toBe("anthropic/claude-3-haiku");
  });

  test("observerModelId is undefined when OBSERVER_MODEL is unset", () => {
    delete Bun.env.OBSERVER_MODEL;
    const config = loadServerConfig();
    expect(config.observerModelId).toBeUndefined();
  });

  test("observerModelId is undefined when OBSERVER_MODEL is whitespace", () => {
    Bun.env.OBSERVER_MODEL = "   ";
    const config = loadServerConfig();
    expect(config.observerModelId).toBeUndefined();
  });
});
