/**
 * Unit Tests: Identity Resolver (pure function)
 *
 * Tests the pure identity resolution function that extracts identity signals
 * from Claude Code metadata.user_id and X-Brain-* headers.
 */
import { describe, expect, it } from "bun:test";
import { resolveIdentity, resolveAgentName, type IdentitySignals } from "../../app/src/server/proxy/identity-resolver";

// ---------------------------------------------------------------------------
// Full identity resolution from Claude Code metadata + headers
// ---------------------------------------------------------------------------
describe("resolveIdentity", () => {
  it("extracts all identity fields from Claude Code metadata and headers", () => {
    const result = resolveIdentity({
      metadataUserId: "user_a1b2c3_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      workspaceHeader: "ws-123",
      taskHeader: "task-456",
      agentTypeHeader: "coding-agent",
    });

    expect(result.userHash).toBe("a1b2c3");
    expect(result.accountId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.sessionId).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(result.workspaceId).toBe("ws-123");
    expect(result.taskId).toBe("task-456");
    expect(result.agentType).toBe("coding-agent");
  });

  it("resolves workspace-only when no metadata is present", () => {
    const result = resolveIdentity({
      workspaceHeader: "ws-789",
    });

    expect(result.workspaceId).toBe("ws-789");
    expect(result.userHash).toBeUndefined();
    expect(result.accountId).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.taskId).toBeUndefined();
    expect(result.agentType).toBeUndefined();
  });

  it("returns empty signals when no identity information is provided", () => {
    const result = resolveIdentity({});

    expect(result.workspaceId).toBeUndefined();
    expect(result.userHash).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });

  it("handles malformed metadata.user_id as opaque user hash", () => {
    const result = resolveIdentity({
      metadataUserId: "some-random-string-not-matching-pattern",
      workspaceHeader: "ws-abc",
    });

    expect(result.userHash).toBe("some-random-string-not-matching-pattern");
    expect(result.accountId).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.workspaceId).toBe("ws-abc");
  });

  it("preserves both metadata session and header session separately", () => {
    const result = resolveIdentity({
      metadataUserId: "user_abc123_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      workspaceHeader: "ws-1",
      sessionHeader: "header-session-id",
    });

    // Both are preserved — resolveSessionId decides priority
    expect(result.sessionId).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(result.sessionHeaderId).toBe("header-session-id");
  });

  it("extracts session from header when no metadata present", () => {
    const result = resolveIdentity({
      workspaceHeader: "ws-1",
      sessionHeader: "explicit-session-id",
    });

    expect(result.sessionHeaderId).toBe("explicit-session-id");
    expect(result.sessionId).toBeUndefined();
  });

  it("passes through User-Agent string", () => {
    const result = resolveIdentity({
      userAgent: "claude-cli/1.0.0",
    });

    expect(result.userAgent).toBe("claude-cli/1.0.0");
  });
});

// ---------------------------------------------------------------------------
// Agent name resolution
// ---------------------------------------------------------------------------
describe("resolveAgentName", () => {
  it("returns agentType header when present", () => {
    expect(resolveAgentName({ agentType: "coding-agent" })).toBe("coding-agent");
  });

  it("returns agentType header even when User-Agent contains claude-cli", () => {
    expect(resolveAgentName({ agentType: "architect", userAgent: "claude-cli/1.0" })).toBe("architect");
  });

  it("returns claude-cli when User-Agent contains claude-cli", () => {
    expect(resolveAgentName({ userAgent: "claude-cli/1.0.0" })).toBe("claude-cli");
  });

  it("returns claude-cli for various claude-cli User-Agent formats", () => {
    expect(resolveAgentName({ userAgent: "claude-cli" })).toBe("claude-cli");
    expect(resolveAgentName({ userAgent: "something claude-cli/2.0 other" })).toBe("claude-cli");
  });

  it("returns proxy when no signals present", () => {
    expect(resolveAgentName({})).toBe("proxy");
  });

  it("returns proxy for unrecognized User-Agent", () => {
    expect(resolveAgentName({ userAgent: "curl/7.88.1" })).toBe("proxy");
  });
});
