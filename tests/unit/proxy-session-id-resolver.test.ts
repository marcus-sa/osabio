/**
 * Unit Tests: Session ID Resolver (pure function)
 *
 * Tests the pure session ID resolution function that determines
 * the effective session ID from identity signals.
 *
 * Session ID sources (priority order):
 * 1. X-Osabio-Session header (explicit override)
 * 2. metadata.user_id session_{uuid} pattern (Claude Code format)
 * 3. undefined (no session attribution)
 */
import { describe, expect, it } from "bun:test";
import { resolveSessionId } from "../../app/src/server/proxy/session-id-resolver";

describe("resolveSessionId", () => {
  it("returns session header when present", () => {
    const result = resolveSessionId({
      sessionHeaderId: "header-session-123",
    });

    expect(result).toBe("header-session-123");
  });

  it("returns metadata session when no header present", () => {
    const result = resolveSessionId({
      sessionId: "metadata-session-456",
    });

    expect(result).toBe("metadata-session-456");
  });

  it("prefers header session over metadata session", () => {
    const result = resolveSessionId({
      sessionHeaderId: "header-session",
      sessionId: "metadata-session",
    });

    expect(result).toBe("header-session");
  });

  it("returns undefined when no session signals present", () => {
    const result = resolveSessionId({});

    expect(result).toBeUndefined();
  });

  it("returns undefined when signals have no session fields", () => {
    const result = resolveSessionId({
      workspaceId: "ws-1",
      userHash: "abc",
    });

    expect(result).toBeUndefined();
  });
});
