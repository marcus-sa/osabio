/**
 * Proxy Auth Unit Tests — PA-10..PA-13
 *
 * Tests for intent + session field support in proxy token resolution.
 * Uses pure function stubs for LookupProxyToken (driven port).
 */
import { describe, test, expect } from "bun:test";
import {
  resolveProxyAuth,
  createTokenCache,
  type ProxyAuthResult,
  type ProxyTokenRecord,
  type LookupProxyToken,
} from "../../../app/src/server/proxy/proxy-auth";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createHeaders(token: string): Headers {
  const headers = new Headers();
  headers.set("X-Osabio-Auth", token);
  return headers;
}

const FIXED_NOW = new Date("2026-03-25T10:00:00Z").getTime();
const ONE_HOUR_FROM_NOW = new Date("2026-03-25T11:00:00Z");

function fixedClock(): () => number {
  return () => FIXED_NOW;
}

// ---------------------------------------------------------------------------
// PA-10: resolveProxyAuth returns intentId + sessionId when present
// ---------------------------------------------------------------------------
describe("PA-10: resolveProxyAuth returns intentId and sessionId when token has intent+session", () => {
  test("should include intentId and sessionId in result when token record has intent and session", async () => {
    const lookupStub: LookupProxyToken = async () => ({
      workspaceId: "ws-001",
      identityId: "id-001",
      expiresAt: ONE_HOUR_FROM_NOW,
      revoked: false,
      intentId: "intent-abc",
      sessionId: "session-xyz",
    });

    const result = await resolveProxyAuth(
      createHeaders("brp_test_token"),
      lookupStub,
      createTokenCache(),
      { now: fixedClock() },
    );

    expect(result).toBeDefined();
    expect(result!.workspaceId).toBe("ws-001");
    expect(result!.identityId).toBe("id-001");
    expect(result!.intentId).toBe("intent-abc");
    expect(result!.sessionId).toBe("session-xyz");
  });
});

// ---------------------------------------------------------------------------
// PA-11: resolveProxyAuth returns undefined intentId/sessionId for legacy tokens
// ---------------------------------------------------------------------------
describe("PA-11: resolveProxyAuth returns undefined intentId/sessionId for legacy tokens", () => {
  test("should return result without intentId/sessionId when token record lacks intent and session", async () => {
    const lookupStub: LookupProxyToken = async () => ({
      workspaceId: "ws-002",
      identityId: "id-002",
      expiresAt: ONE_HOUR_FROM_NOW,
      revoked: false,
    });

    const result = await resolveProxyAuth(
      createHeaders("brp_legacy_token"),
      lookupStub,
      createTokenCache(),
      { now: fixedClock() },
    );

    expect(result).toBeDefined();
    expect(result!.workspaceId).toBe("ws-002");
    expect(result!.identityId).toBe("id-002");
    expect(result!.intentId).toBeUndefined();
    expect(result!.sessionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PA-12: ProxyAuthResult type includes optional intentId and sessionId
// ---------------------------------------------------------------------------
describe("PA-12: ProxyAuthResult type includes optional intentId and sessionId", () => {
  test("should allow constructing ProxyAuthResult with intentId and sessionId", () => {
    const result: ProxyAuthResult = {
      workspaceId: "ws-003",
      identityId: "id-003",
      intentId: "intent-def",
      sessionId: "session-uvw",
    };

    expect(result.intentId).toBe("intent-def");
    expect(result.sessionId).toBe("session-uvw");
  });

  test("should allow constructing ProxyAuthResult without intentId and sessionId", () => {
    const result: ProxyAuthResult = {
      workspaceId: "ws-004",
      identityId: "id-004",
    };

    expect(result.intentId).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PA-13: LookupProxyToken maps intent/session RecordId to string IDs
// ---------------------------------------------------------------------------
describe("PA-13: ProxyTokenRecord supports optional intentId and sessionId", () => {
  test("should allow ProxyTokenRecord with intentId and sessionId from adapter mapping", () => {
    const record: ProxyTokenRecord = {
      workspaceId: "ws-005",
      identityId: "id-005",
      expiresAt: ONE_HOUR_FROM_NOW,
      revoked: false,
      intentId: "intent-ghi",
      sessionId: "session-rst",
    };

    expect(record.intentId).toBe("intent-ghi");
    expect(record.sessionId).toBe("session-rst");
  });

  test("resolveProxyAuth passes through intentId/sessionId from lookup to result", async () => {
    const lookupStub: LookupProxyToken = async () => ({
      workspaceId: "ws-006",
      identityId: "id-006",
      expiresAt: ONE_HOUR_FROM_NOW,
      revoked: false,
      intentId: "intent-jkl",
      sessionId: "session-mno",
    });

    const result = await resolveProxyAuth(
      createHeaders("brp_mapped_token"),
      lookupStub,
      createTokenCache(),
      { now: fixedClock() },
    );

    expect(result).toBeDefined();
    expect(result!.intentId).toBe("intent-jkl");
    expect(result!.sessionId).toBe("session-mno");
  });
});
