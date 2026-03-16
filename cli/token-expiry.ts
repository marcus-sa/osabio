/**
 * Pure function for proxy token expiry checking.
 * No IO — used by SessionStart hook at the boundary.
 */

export type TokenExpiryStatus =
  | { status: "ok" }
  | { status: "expiring_soon"; daysRemaining: number }
  | { status: "expired" };

const WARN_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Check whether a proxy token is expired or expiring soon.
 *
 * @param expiresAt - ISO 8601 date string from config (proxy_token_expires_at), or undefined if no proxy token
 * @param now - current time in epoch ms (injected for testability)
 */
export function checkTokenExpiry(
  expiresAt: string | undefined,
  now: number,
): TokenExpiryStatus {
  if (expiresAt === undefined) return { status: "ok" };

  const expiresMs = new Date(expiresAt).getTime();
  const remainingMs = expiresMs - now;

  if (remainingMs <= 0) return { status: "expired" };

  const daysRemaining = Math.floor(remainingMs / MS_PER_DAY);

  if (daysRemaining <= WARN_THRESHOLD_DAYS) {
    return { status: "expiring_soon", daysRemaining };
  }

  return { status: "ok" };
}
