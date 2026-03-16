/**
 * Unit tests for use-public-config hook.
 *
 * Tests the pure parseConfigResponse logic and exported constants.
 * React state/effect behavior is integration-level.
 */
import { describe, expect, it } from "bun:test";
import {
  parseConfigResponse,
  CONFIG_URL,
  type PublicConfig,
} from "../../app/src/client/hooks/use-public-config";

describe("parseConfigResponse", () => {
  it("parses a valid self-hosted config", () => {
    const result = parseConfigResponse({
      selfHosted: true,
      worktreeManagerEnabled: false,
    });
    expect(result).toEqual({
      selfHosted: true,
      worktreeManagerEnabled: false,
    } satisfies PublicConfig);
  });

  it("parses a valid non-self-hosted config", () => {
    const result = parseConfigResponse({
      selfHosted: false,
      worktreeManagerEnabled: true,
    });
    expect(result).toEqual({
      selfHosted: false,
      worktreeManagerEnabled: true,
    });
  });

  it("defaults worktreeManagerEnabled to false when missing", () => {
    const result = parseConfigResponse({ selfHosted: true });
    expect(result).toEqual({
      selfHosted: true,
      worktreeManagerEnabled: false,
    });
  });

  it("returns default config for non-object input", () => {
    expect(parseConfigResponse(null)).toEqual({
      selfHosted: false,
      worktreeManagerEnabled: false,
    });
    expect(parseConfigResponse("string")).toEqual({
      selfHosted: false,
      worktreeManagerEnabled: false,
    });
    expect(parseConfigResponse(42)).toEqual({
      selfHosted: false,
      worktreeManagerEnabled: false,
    });
  });

  it("returns default config when selfHosted is not boolean", () => {
    expect(parseConfigResponse({ selfHosted: "yes" })).toEqual({
      selfHosted: false,
      worktreeManagerEnabled: false,
    });
  });

  it("ignores extra fields in response", () => {
    const result = parseConfigResponse({
      selfHosted: true,
      worktreeManagerEnabled: true,
      unknownField: "ignored",
    });
    expect(result).toEqual({
      selfHosted: true,
      worktreeManagerEnabled: true,
    });
  });
});

describe("CONFIG_URL", () => {
  it("points to the public config endpoint", () => {
    expect(CONFIG_URL).toBe("/api/config");
  });
});
