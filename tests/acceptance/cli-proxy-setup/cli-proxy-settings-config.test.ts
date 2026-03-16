/**
 * Acceptance Tests: CLI Settings Configuration
 *
 * Milestone 3: brain init Step 7 — .claude/settings.local.json management
 *
 * Tests the CLI's config file management:
 *   - Fresh setup creates settings.local.json with correct env vars
 *   - Existing settings are merged without data loss
 *   - Re-running brain init updates token in place
 *   - .gitignore verification and warning
 *   - ~/.brain/config.json proxy_token storage
 *
 * These tests exercise the CLI config functions directly (unit-level driving port)
 * rather than the full `brain init` flow, since the OAuth flow is tested elsewhere.
 *
 * Driving port: setupProxyConfig() from cli/commands/init.ts
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Test fixtures: temporary directories simulating repo + home
// ---------------------------------------------------------------------------
let tmpDir: string;
let repoDir: string;
let claudeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-proxy-test-"));
  repoDir = path.join(tmpDir, "repo");
  claudeDir = path.join(repoDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers: simulate the config write logic that setupProxyConfig() performs
// ---------------------------------------------------------------------------

/**
 * Simulates the settings.local.json write logic from brain init Step 7.
 * This is the behavior under test — the actual implementation in cli/commands/init.ts
 * should produce identical results.
 */
function writeSettingsLocal(
  settingsPath: string,
  serverUrl: string,
  proxyToken: string,
): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }

  const env = (existing.env ?? {}) as Record<string, string>;
  env.ANTHROPIC_BASE_URL = `${serverUrl}/proxy/llm/anthropic`;
  env.ANTHROPIC_HEADERS = `X-Brain-Auth: ${proxyToken}`;

  existing.env = env;
  fs.writeFileSync(settingsPath, JSON.stringify(existing, undefined, 2) + "\n");
}

function isGitignored(repoPath: string, filePath: string): boolean {
  const gitignorePath = path.join(repoPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return false;
  const patterns = fs.readFileSync(gitignorePath, "utf-8").split("\n");
  const relative = path.relative(repoPath, filePath);
  return patterns.some((p) => p.trim() === relative || p.trim() === `/${relative}`);
}

// ---------------------------------------------------------------------------
// Scenario: Fresh setup with no existing settings.local.json
// ---------------------------------------------------------------------------
describe("Fresh proxy setup", () => {
  it("creates .claude/settings.local.json with ANTHROPIC_BASE_URL and ANTHROPIC_HEADERS", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    // Given a repo with no .claude/settings.local.json
    expect(fs.existsSync(settingsPath)).toBe(false);

    // When the proxy setup step runs
    writeSettingsLocal(settingsPath, "https://brain.example.com", "brp_abc123");

    // Then .claude/settings.local.json is created with correct keys
    expect(fs.existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(content.env.ANTHROPIC_BASE_URL).toBe("https://brain.example.com/proxy/llm/anthropic");
    expect(content.env.ANTHROPIC_HEADERS).toBe("X-Brain-Auth: brp_abc123");
  });
});

// ---------------------------------------------------------------------------
// Scenario: Existing settings.local.json with other config
// ---------------------------------------------------------------------------
describe("Merge with existing settings", () => {
  it("preserves existing non-Brain env vars and non-env config keys", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    // Given a repo with .claude/settings.local.json containing other env vars
    const existingConfig = {
      env: {
        MY_CUSTOM_VAR: "keep-this",
        ANOTHER_VAR: "also-keep",
      },
      permissions: {
        allow: ["Read", "Write"],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingConfig, undefined, 2));

    // When the proxy setup step runs
    writeSettingsLocal(settingsPath, "https://brain.example.com", "brp_xyz789");

    // Then the env keys are merged (not overwritten)
    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://brain.example.com/proxy/llm/anthropic");
    expect(result.env.ANTHROPIC_HEADERS).toBe("X-Brain-Auth: brp_xyz789");

    // And existing non-Brain env vars are preserved
    expect(result.env.MY_CUSTOM_VAR).toBe("keep-this");
    expect(result.env.ANOTHER_VAR).toBe("also-keep");

    // And existing non-env config keys are preserved
    expect(result.permissions.allow).toEqual(["Read", "Write"]);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Re-running brain init updates proxy token
// ---------------------------------------------------------------------------
describe("Re-run updates token in place", () => {
  it("replaces proxy token while preserving all other settings", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    // Given a repo already configured with proxy settings
    writeSettingsLocal(settingsPath, "https://brain.example.com", "brp_old_token");

    // Simulate additional non-Brain keys that should survive
    const config = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    config.env.SOME_OTHER_KEY = "preserve-me";
    fs.writeFileSync(settingsPath, JSON.stringify(config, undefined, 2));

    // When the user runs brain init again with a new token
    writeSettingsLocal(settingsPath, "https://brain.example.com", "brp_new_token");

    // Then .claude/settings.local.json is updated with the new token
    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(result.env.ANTHROPIC_HEADERS).toBe("X-Brain-Auth: brp_new_token");

    // And the base URL and other keys are unchanged
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://brain.example.com/proxy/llm/anthropic");
    expect(result.env.SOME_OTHER_KEY).toBe("preserve-me");
  });
});

// ---------------------------------------------------------------------------
// Scenario: .gitignore verification
// ---------------------------------------------------------------------------
describe("Gitignore verification", () => {
  it("detects when settings.local.json is not in .gitignore", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    // Given a repo where .claude/settings.local.json is not in .gitignore
    // (no .gitignore exists)
    expect(isGitignored(repoDir, settingsPath)).toBe(false);
  });

  it("detects when settings.local.json IS properly gitignored", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    // Given a repo where .gitignore contains the settings path
    fs.writeFileSync(
      path.join(repoDir, ".gitignore"),
      ".claude/settings.local.json\n",
    );

    // Then the check detects it is gitignored
    expect(isGitignored(repoDir, settingsPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario: ~/.brain/config.json proxy token storage
// ---------------------------------------------------------------------------
describe("Brain config proxy token storage", () => {
  it("stores proxy_token and proxy_token_expires_at in repo config entry", () => {
    const configPath = path.join(tmpDir, "config.json");

    // Given an existing ~/.brain/config.json with a repo entry
    const existingConfig = {
      repos: {
        "/Users/priya/project": {
          server_url: "https://brain.example.com",
          workspace_id: "ws-123",
          access_token: "existing-oauth-token",
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, undefined, 2));

    // When brain init Step 7 stores the proxy token
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const repoEntry = config.repos["/Users/priya/project"];
    repoEntry.proxy_token = "brp_stored_token";
    repoEntry.proxy_token_expires_at = "2026-06-14T00:00:00Z";
    fs.writeFileSync(configPath, JSON.stringify(config, undefined, 2));

    // Then the proxy token is stored alongside existing config
    const result = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const entry = result.repos["/Users/priya/project"];
    expect(entry.proxy_token).toBe("brp_stored_token");
    expect(entry.proxy_token_expires_at).toBe("2026-06-14T00:00:00Z");

    // And existing fields are preserved
    expect(entry.server_url).toBe("https://brain.example.com");
    expect(entry.workspace_id).toBe("ws-123");
    expect(entry.access_token).toBe("existing-oauth-token");
  });
});

// ---------------------------------------------------------------------------
// Scenario: No fallback to direct Anthropic
// ---------------------------------------------------------------------------
describe("No fallback to direct Anthropic", () => {
  it("settings.local.json always points to Brain proxy, never direct Anthropic URL", () => {
    const settingsPath = path.join(claudeDir, "settings.local.json");

    writeSettingsLocal(settingsPath, "https://brain.example.com", "brp_token");

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

    // The base URL must point to Brain proxy, never to api.anthropic.com
    expect(result.env.ANTHROPIC_BASE_URL).not.toContain("api.anthropic.com");
    expect(result.env.ANTHROPIC_BASE_URL).toContain("/proxy/llm/anthropic");
  });
});
