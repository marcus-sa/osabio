/**
 * Unit Tests: CLI Proxy Settings Pure Functions
 *
 * Tests the pure functions extracted for proxy config management:
 *   - mergeProxyEnvSettings: merge proxy env vars into settings object
 *   - checkSettingsGitignored: detect if settings.local.json is in .gitignore
 *
 * These are pure functions with no IO — they transform data in, data out.
 */
import { describe, expect, it } from "bun:test";
import {
  mergeProxyEnvSettings,
  checkSettingsGitignored,
} from "../../cli/proxy-settings";

// ---------------------------------------------------------------------------
// mergeProxyEnvSettings
// ---------------------------------------------------------------------------

describe("mergeProxyEnvSettings", () => {
  it("creates env block from empty settings", () => {
    const result = mergeProxyEnvSettings(
      {},
      "https://osabio.example.com",
      "brp_abc123",
    );

    expect(result.env.ANTHROPIC_BASE_URL).toBe(
      "https://osabio.example.com/proxy/llm/anthropic",
    );
    expect(result.env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Osabio-Auth: brp_abc123");
  });

  it("preserves existing non-Brain env vars", () => {
    const existing = {
      env: {
        MY_CUSTOM_VAR: "keep-this",
        ANOTHER_VAR: "also-keep",
      },
    };

    const result = mergeProxyEnvSettings(
      existing,
      "https://osabio.example.com",
      "brp_xyz789",
    );

    expect(result.env.MY_CUSTOM_VAR).toBe("keep-this");
    expect(result.env.ANOTHER_VAR).toBe("also-keep");
    expect(result.env.ANTHROPIC_BASE_URL).toBe(
      "https://osabio.example.com/proxy/llm/anthropic",
    );
    expect(result.env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Osabio-Auth: brp_xyz789");
  });

  it("preserves existing non-env config keys", () => {
    const existing = {
      permissions: { allow: ["Read", "Write"] },
      env: { SOME_KEY: "value" },
    };

    const result = mergeProxyEnvSettings(
      existing,
      "https://osabio.example.com",
      "osp_token",
    );

    expect((result as Record<string, unknown>).permissions).toEqual({
      allow: ["Read", "Write"],
    });
    expect(result.env.SOME_KEY).toBe("value");
  });

  it("replaces proxy token on re-run", () => {
    const existing = {
      env: {
        ANTHROPIC_BASE_URL: "https://osabio.example.com/proxy/llm/anthropic",
        ANTHROPIC_CUSTOM_HEADERS: "X-Osabio-Auth: brp_old_token",
        SOME_OTHER_KEY: "preserve-me",
      },
    };

    const result = mergeProxyEnvSettings(
      existing,
      "https://osabio.example.com",
      "brp_new_token",
    );

    expect(result.env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Osabio-Auth: brp_new_token");
    expect(result.env.ANTHROPIC_BASE_URL).toBe(
      "https://osabio.example.com/proxy/llm/anthropic",
    );
    expect(result.env.SOME_OTHER_KEY).toBe("preserve-me");
  });

  it("does not mutate the input object", () => {
    const existing = { env: { MY_KEY: "original" } };
    const copy = JSON.parse(JSON.stringify(existing));

    mergeProxyEnvSettings(existing, "https://osabio.example.com", "osp_token");

    expect(existing).toEqual(copy);
  });

  it("always points to Brain proxy, never direct Anthropic URL", () => {
    const result = mergeProxyEnvSettings(
      {},
      "https://osabio.example.com",
      "osp_token",
    );

    expect(result.env.ANTHROPIC_BASE_URL).not.toContain("api.anthropic.com");
    expect(result.env.ANTHROPIC_BASE_URL).toContain("/proxy/llm/anthropic");
  });
});

// ---------------------------------------------------------------------------
// checkSettingsGitignored
// ---------------------------------------------------------------------------

describe("checkSettingsGitignored", () => {
  it("returns false when gitignore content is undefined (no file)", () => {
    expect(checkSettingsGitignored(undefined)).toBe(false);
  });

  it("returns false when gitignore is empty", () => {
    expect(checkSettingsGitignored("")).toBe(false);
  });

  it("returns false when settings.local.json not listed", () => {
    expect(checkSettingsGitignored("node_modules/\n.env\n")).toBe(false);
  });

  it("returns true when .claude/settings.local.json is listed", () => {
    expect(
      checkSettingsGitignored("node_modules/\n.claude/settings.local.json\n"),
    ).toBe(true);
  });

  it("returns true when /.claude/settings.local.json is listed (leading slash)", () => {
    expect(
      checkSettingsGitignored("/.claude/settings.local.json\n"),
    ).toBe(true);
  });

  it("returns true when settings.local.json appears as bare filename", () => {
    expect(
      checkSettingsGitignored("settings.local.json\n"),
    ).toBe(true);
  });

  it("ignores comment lines", () => {
    expect(
      checkSettingsGitignored("# .claude/settings.local.json\n"),
    ).toBe(false);
  });

  it("handles whitespace around patterns", () => {
    expect(
      checkSettingsGitignored("  .claude/settings.local.json  \n"),
    ).toBe(true);
  });
});
