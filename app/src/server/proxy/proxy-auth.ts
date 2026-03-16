/**
 * Proxy Auth Middleware — Resolve Brain auth tokens to workspace + identity
 *
 * Pipeline:
 *   1. Extract X-Brain-Auth header value
 *   2. SHA-256 hash the raw token
 *   3. Check in-memory TTL cache for cached resolution
 *   4. If cache miss, query proxy_token table for valid (non-expired, non-revoked) record
 *   5. Cache the resolution result
 *   6. Return { workspaceId, identityId } or undefined (pass-through)
 *
 * Driving port: extractBrainAuthToken, resolveProxyAuth
 * Driven port: LookupProxyToken (function signature — SurrealDB adapter)
 *
 * Design:
 *   - Pure core functions (extractBrainAuthToken, resolveProxyAuth logic)
 *   - Cache injected as dependency (no module-level singletons)
 *   - LookupProxyToken is a function signature (port), not a concrete DB call
 */
import { RecordId } from "surrealdb";
import { hashProxyToken } from "./proxy-token-core";
import type { ServerDependencies } from "../runtime/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProxyAuthResult = {
  workspaceId: string;
  identityId: string;
};

export type ProxyTokenRecord = {
  workspaceId: string;
  identityId: string;
  expiresAt: Date;
  revoked: boolean;
};

/** Driven port: look up a proxy token by its SHA-256 hash */
export type LookupProxyToken = (
  tokenHash: string,
) => Promise<ProxyTokenRecord | undefined>;

export type TokenCacheEntry = {
  result: ProxyAuthResult;
  expiresAt: number; // epoch ms
};

export type TokenCache = Map<string, TokenCacheEntry>;

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Extract the Brain auth token from request headers.
 * Returns undefined if the header is missing or empty (pass-through to existing auth).
 */
export function extractBrainAuthToken(
  headers: Headers,
): string | undefined {
  const value = headers.get("X-Brain-Auth");
  if (!value || value.trim().length === 0) return undefined;
  return value.trim();
}

/**
 * Create a TTL-based token cache. Returns a plain Map — the TTL is enforced
 * at read time by resolveProxyAuth, not by the cache itself.
 */
export function createTokenCache(): TokenCache {
  return new Map();
}

/**
 * Check the cache for a valid (non-expired) entry.
 * Returns the cached ProxyAuthResult or undefined if miss/expired.
 */
export function getCachedAuth(
  cache: TokenCache,
  tokenHash: string,
  nowMs: number,
): ProxyAuthResult | undefined {
  const entry = cache.get(tokenHash);
  if (!entry) return undefined;
  if (nowMs >= entry.expiresAt) {
    cache.delete(tokenHash);
    return undefined;
  }
  return entry.result;
}

/**
 * Store a resolution result in the cache with a TTL.
 */
export function setCachedAuth(
  cache: TokenCache,
  tokenHash: string,
  result: ProxyAuthResult,
  ttlMs: number,
  nowMs: number,
): void {
  cache.set(tokenHash, {
    result,
    expiresAt: nowMs + ttlMs,
  });
}

// ---------------------------------------------------------------------------
// Orchestrator (still pure — IO injected via LookupProxyToken)
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type ResolveProxyAuthOptions = {
  cacheTtlMs?: number;
  now?: () => number;
};

/**
 * Resolve a Brain auth token to workspace + identity.
 *
 * Returns:
 *   - ProxyAuthResult on success (valid, non-expired, non-revoked token)
 *   - undefined when no X-Brain-Auth header is present (pass-through)
 *   - Throws with descriptive message for invalid/expired/revoked tokens
 *
 * @param headers - Request headers
 * @param lookupToken - Driven port for DB lookup
 * @param cache - Injected token cache
 * @param options - Optional TTL and clock overrides
 */
export async function resolveProxyAuth(
  headers: Headers,
  lookupToken: LookupProxyToken,
  cache: TokenCache,
  options?: ResolveProxyAuthOptions,
): Promise<ProxyAuthResult | undefined> {
  const rawToken = extractBrainAuthToken(headers);
  if (!rawToken) return undefined;

  const tokenHash = hashProxyToken(rawToken);
  const nowMs = (options?.now ?? Date.now)();
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  // Check cache first
  const cached = getCachedAuth(cache, tokenHash, nowMs);
  if (cached) return cached;

  // DB lookup via driven port
  const record = await lookupToken(tokenHash);

  if (!record) {
    throw new ProxyAuthError("invalid_token", "Proxy token not found or expired");
  }

  if (record.revoked) {
    throw new ProxyAuthError("token_revoked", "Proxy token has been revoked");
  }

  if (record.expiresAt.getTime() <= nowMs) {
    throw new ProxyAuthError("token_expired", "Proxy token has expired");
  }

  const result: ProxyAuthResult = {
    workspaceId: record.workspaceId,
    identityId: record.identityId,
  };

  // Cache the successful resolution
  setCachedAuth(cache, tokenHash, result, cacheTtlMs, nowMs);

  return result;
}

// ---------------------------------------------------------------------------
// Error Type
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SurrealDB Adapter (driven port implementation)
// ---------------------------------------------------------------------------

type ProxyTokenRow = {
  workspace: RecordId;
  identity: RecordId;
  expires_at: Date;
  revoked: boolean;
};

/**
 * Create a LookupProxyToken adapter backed by SurrealDB.
 * Queries the proxy_token table for a non-revoked, non-expired record
 * matching the given token hash.
 */
export function createLookupProxyToken(
  surreal: ServerDependencies["surreal"],
): LookupProxyToken {
  return async (tokenHash: string): Promise<ProxyTokenRecord | undefined> => {
    const results = await surreal.query<[ProxyTokenRow[]]>(
      `SELECT workspace, identity, expires_at, revoked FROM proxy_token WHERE token_hash = $hash LIMIT 1;`,
      { hash: tokenHash },
    );

    const row = results[0]?.[0];
    if (!row) return undefined;

    return {
      workspaceId: row.workspace.id as string,
      identityId: row.identity.id as string,
      expiresAt: new Date(row.expires_at),
      revoked: row.revoked,
    };
  };
}

// ---------------------------------------------------------------------------
// Error Type
// ---------------------------------------------------------------------------

export type ProxyAuthErrorCode = "invalid_token" | "token_revoked" | "token_expired";

export class ProxyAuthError extends Error {
  readonly code: ProxyAuthErrorCode;

  constructor(code: ProxyAuthErrorCode, message: string) {
    super(message);
    this.name = "ProxyAuthError";
    this.code = code;
  }
}
