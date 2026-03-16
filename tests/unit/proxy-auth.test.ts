/**
 * Unit Tests: Proxy Auth Middleware (Pure Functions)
 *
 * Tests the proxy authentication pipeline:
 *   - Header extraction (X-Brain-Auth)
 *   - Token resolution with cache hit/miss
 *   - Expired/revoked/invalid token rejection
 *   - Cache TTL behavior
 *   - Pass-through when no Brain auth header
 *
 * All DB lookups are stubbed via the LookupProxyToken port.
 */
import { describe, expect, it } from "bun:test";
import {
  extractBrainAuthToken,
  resolveProxyAuth,
  getCachedAuth,
  setCachedAuth,
  createTokenCache,
  ProxyAuthError,
  type LookupProxyToken,
  type TokenCache,
  type ProxyTokenRecord,
} from "../../app/src/server/proxy/proxy-auth";
import { hashProxyToken } from "../../app/src/server/proxy/proxy-token-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeaders(brainAuth?: string): Headers {
  const headers = new Headers();
  if (brainAuth !== undefined) {
    headers.set("X-Brain-Auth", brainAuth);
  }
  return headers;
}

function stubLookup(record?: ProxyTokenRecord): LookupProxyToken {
  return async (_hash: string) => record;
}

function spyLookup(record?: ProxyTokenRecord): {
  lookup: LookupProxyToken;
  calls: string[];
} {
  const calls: string[] = [];
  const lookup: LookupProxyToken = async (hash: string) => {
    calls.push(hash);
    return record;
  };
  return { lookup, calls };
}

const VALID_TOKEN = "brp_abc123def456789012345678901234567890123456789012345678901234";
const NOW_MS = new Date("2026-03-16T12:00:00Z").getTime();
const FUTURE_DATE = new Date("2026-06-16T12:00:00Z");
const PAST_DATE = new Date("2026-01-01T00:00:00Z");

const VALID_RECORD: ProxyTokenRecord = {
  workspaceId: "ws-test-1",
  identityId: "id-test-1",
  expiresAt: FUTURE_DATE,
  revoked: false,
};

// ---------------------------------------------------------------------------
// extractBrainAuthToken
// ---------------------------------------------------------------------------

describe("extractBrainAuthToken", () => {
  it("returns token when X-Brain-Auth header is present", () => {
    const headers = makeHeaders(VALID_TOKEN);
    expect(extractBrainAuthToken(headers)).toBe(VALID_TOKEN);
  });

  it("returns undefined when header is missing", () => {
    const headers = makeHeaders();
    expect(extractBrainAuthToken(headers)).toBeUndefined();
  });

  it("returns undefined when header is empty string", () => {
    const headers = makeHeaders("");
    expect(extractBrainAuthToken(headers)).toBeUndefined();
  });

  it("returns undefined when header is whitespace-only", () => {
    const headers = makeHeaders("   ");
    expect(extractBrainAuthToken(headers)).toBeUndefined();
  });

  it("trims whitespace from token value", () => {
    const headers = makeHeaders(`  ${VALID_TOKEN}  `);
    expect(extractBrainAuthToken(headers)).toBe(VALID_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Cache (getCachedAuth / setCachedAuth)
// ---------------------------------------------------------------------------

describe("getCachedAuth", () => {
  it("returns undefined on cache miss", () => {
    const cache = createTokenCache();
    const result = getCachedAuth(cache, "some-hash", NOW_MS);
    expect(result).toBeUndefined();
  });

  it("returns cached result when entry is fresh", () => {
    const cache = createTokenCache();
    const expected = { workspaceId: "ws-1", identityId: "id-1" };
    setCachedAuth(cache, "hash-1", expected, 300_000, NOW_MS);

    const result = getCachedAuth(cache, "hash-1", NOW_MS + 1000);
    expect(result).toEqual(expected);
  });

  it("returns undefined and evicts when entry is expired", () => {
    const cache = createTokenCache();
    const expected = { workspaceId: "ws-1", identityId: "id-1" };
    setCachedAuth(cache, "hash-1", expected, 300_000, NOW_MS);

    // 5 minutes + 1ms later
    const result = getCachedAuth(cache, "hash-1", NOW_MS + 300_001);
    expect(result).toBeUndefined();
    expect(cache.has("hash-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveProxyAuth
// ---------------------------------------------------------------------------

describe("resolveProxyAuth", () => {
  it("returns undefined when no X-Brain-Auth header is present (pass-through)", async () => {
    const headers = makeHeaders();
    const cache = createTokenCache();
    const result = await resolveProxyAuth(
      headers,
      stubLookup(VALID_RECORD),
      cache,
      { now: () => NOW_MS },
    );
    expect(result).toBeUndefined();
  });

  it("resolves valid token to workspace and identity", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const result = await resolveProxyAuth(
      headers,
      stubLookup(VALID_RECORD),
      cache,
      { now: () => NOW_MS },
    );
    expect(result).toEqual({
      workspaceId: "ws-test-1",
      identityId: "id-test-1",
    });
  });

  it("throws ProxyAuthError for token not found in DB", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    try {
      await resolveProxyAuth(
        headers,
        stubLookup(undefined),
        cache,
        { now: () => NOW_MS },
      );
      expect(true).toBe(false); // should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyAuthError);
      expect((error as ProxyAuthError).code).toBe("invalid_token");
    }
  });

  it("throws ProxyAuthError for expired token", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const expiredRecord: ProxyTokenRecord = {
      ...VALID_RECORD,
      expiresAt: PAST_DATE,
    };
    try {
      await resolveProxyAuth(
        headers,
        stubLookup(expiredRecord),
        cache,
        { now: () => NOW_MS },
      );
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyAuthError);
      expect((error as ProxyAuthError).code).toBe("token_expired");
    }
  });

  it("throws ProxyAuthError for revoked token", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const revokedRecord: ProxyTokenRecord = {
      ...VALID_RECORD,
      revoked: true,
    };
    try {
      await resolveProxyAuth(
        headers,
        stubLookup(revokedRecord),
        cache,
        { now: () => NOW_MS },
      );
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyAuthError);
      expect((error as ProxyAuthError).code).toBe("token_revoked");
    }
  });

  it("serves repeated lookups from cache without DB call", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const { lookup, calls } = spyLookup(VALID_RECORD);

    // First call hits DB
    await resolveProxyAuth(headers, lookup, cache, { now: () => NOW_MS });
    expect(calls.length).toBe(1);

    // Second call within TTL uses cache
    await resolveProxyAuth(headers, lookup, cache, { now: () => NOW_MS + 1000 });
    expect(calls.length).toBe(1); // no additional DB call
  });

  it("re-queries DB after cache TTL expires", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const { lookup, calls } = spyLookup(VALID_RECORD);
    const cacheTtlMs = 300_000; // 5 min

    // First call
    await resolveProxyAuth(headers, lookup, cache, {
      now: () => NOW_MS,
      cacheTtlMs,
    });
    expect(calls.length).toBe(1);

    // After TTL expires
    await resolveProxyAuth(headers, lookup, cache, {
      now: () => NOW_MS + cacheTtlMs + 1,
      cacheTtlMs,
    });
    expect(calls.length).toBe(2);
  });

  it("hashes the token before lookup (never sends raw token to DB)", async () => {
    const headers = makeHeaders(VALID_TOKEN);
    const cache = createTokenCache();
    const { lookup, calls } = spyLookup(VALID_RECORD);

    await resolveProxyAuth(headers, lookup, cache, { now: () => NOW_MS });

    const expectedHash = hashProxyToken(VALID_TOKEN);
    expect(calls[0]).toBe(expectedHash);
    expect(calls[0]).not.toContain("brp_");
  });
});
