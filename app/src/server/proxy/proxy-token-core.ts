/**
 * Proxy Token Core — Pure Domain Functions
 *
 * Cryptographic token generation, hashing, and TTL computation.
 * No IO, no side effects — these are the pure building blocks
 * for the proxy token issuance pipeline.
 */
import { randomBytes, createHash } from "node:crypto";

const TOKEN_PREFIX = "osp_";
const TOKEN_RANDOM_BYTES = 32; // 32 bytes = 64 hex chars

/**
 * Generate a cryptographically random proxy token with brp_ prefix.
 * Format: brp_ + 64 random hex characters.
 */
export function generateProxyToken(): string {
  const hex = randomBytes(TOKEN_RANDOM_BYTES).toString("hex");
  return `${TOKEN_PREFIX}${hex}`;
}

/**
 * Compute SHA-256 hash of a proxy token for storage.
 * Returns a 64-character lowercase hex string.
 */
export function hashProxyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compute the expiration date given a TTL in days.
 */
export function computeExpiresAt(ttlDays: number, now?: Date): Date {
  const base = now ?? new Date();
  return new Date(base.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Read proxy token TTL from environment, defaulting to 90 days.
 */
export function readProxyTokenTtlDays(): number {
  const envValue = Bun.env.PROXY_TOKEN_TTL_DAYS?.trim();
  if (!envValue) return 90;
  const parsed = Number(envValue);
  if (!Number.isInteger(parsed) || parsed < 1) return 90;
  return parsed;
}
