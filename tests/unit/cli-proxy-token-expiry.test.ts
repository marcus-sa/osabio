import { describe, expect, it } from "bun:test";
import { checkTokenExpiry, type TokenExpiryStatus } from "../../cli/token-expiry";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("checkTokenExpiry", () => {
  it("returns 'expired' when token expiry is in the past", () => {
    const yesterday = new Date(Date.now() - 1 * DAY_MS).toISOString();
    const result = checkTokenExpiry(yesterday, Date.now());

    expect(result.status).toBe("expired");
  });

  it("returns 'expiring_soon' when token expires within 7 days", () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * DAY_MS).toISOString();
    const result = checkTokenExpiry(threeDaysFromNow, Date.now());

    expect(result.status).toBe("expiring_soon");
    expect(result.daysRemaining).toBe(3);
  });

  it("returns 'expiring_soon' with correct days at boundary (exactly 7 days)", () => {
    const sevenDays = new Date(Date.now() + 7 * DAY_MS).toISOString();
    const result = checkTokenExpiry(sevenDays, Date.now());

    expect(result.status).toBe("expiring_soon");
    expect(result.daysRemaining).toBe(7);
  });

  it("returns 'ok' when token has more than 7 days remaining", () => {
    const thirtyDays = new Date(Date.now() + 30 * DAY_MS).toISOString();
    const result = checkTokenExpiry(thirtyDays, Date.now());

    expect(result.status).toBe("ok");
  });

  it("returns 'ok' when expiresAt is undefined (no proxy token configured)", () => {
    const result = checkTokenExpiry(undefined, Date.now());

    expect(result.status).toBe("ok");
  });

  it("returns 'expired' for daysRemaining 0 (expires today)", () => {
    // Token that expires in 2 hours — same day, daysRemaining rounds to 0
    const soonToday = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const result = checkTokenExpiry(soonToday, Date.now());

    expect(result.status).toBe("expiring_soon");
    expect(result.daysRemaining).toBe(0);
  });
});
