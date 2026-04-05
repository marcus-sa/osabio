/**
 * Regression test: osabio init fails with "requested resource invalid" when
 * BETTER_AUTH_URL includes an /api/auth path suffix.
 *
 * Root cause: validAudiences in auth/config.ts was set to [config.betterAuthUrl]
 * (e.g. "http://localhost:3000/api/auth") instead of [new URL(config.betterAuthUrl).origin]
 * (e.g. "http://localhost:3000"). The CLI sends resource=<origin>, so the exact-string
 * set-membership check in @better-auth/oauth-provider rejected the token exchange.
 */
import { describe, expect, it } from "bun:test";

/**
 * Mirrors the validAudiences expression in app/src/server/auth/config.ts.
 * Any change to that expression must be reflected here to keep the test meaningful.
 */
function buildValidAudiences(betterAuthUrl: string): string[] {
  return [new URL(betterAuthUrl).origin];
}

/**
 * Mirrors how the CLI derives the resource parameter in cli/commands/init.ts.
 */
function cliResourceFromServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/, "");
}

describe("oauth validAudiences configuration", () => {
  it("accepts CLI resource when BETTER_AUTH_URL has /api/auth suffix", () => {
    // Typical deployment config — BETTER_AUTH_URL includes the Better Auth path prefix
    const betterAuthUrl = "http://localhost:3000/api/auth";
    const serverUrl = "http://localhost:3000";

    const audiences = buildValidAudiences(betterAuthUrl);
    const cliResource = cliResourceFromServerUrl(serverUrl);

    // Before fix: audiences = ["http://localhost:3000/api/auth"], cliResource = "http://localhost:3000"
    // → set membership fails → 400 "requested resource invalid"
    //
    // After fix: audiences = ["http://localhost:3000"], cliResource = "http://localhost:3000"
    // → set membership passes → token exchange succeeds
    expect(audiences).toContain(cliResource);
  });

  it("still works when BETTER_AUTH_URL has no path suffix", () => {
    // Configurations where BETTER_AUTH_URL = origin only were unaffected by the bug.
    // Ensure the fix does not regress them.
    const betterAuthUrl = "http://localhost:3000";
    const serverUrl = "http://localhost:3000";

    const audiences = buildValidAudiences(betterAuthUrl);
    const cliResource = cliResourceFromServerUrl(serverUrl);

    expect(audiences).toContain(cliResource);
  });

  it("works for production HTTPS URLs with path suffix", () => {
    const betterAuthUrl = "https://app.example.com/api/auth";
    const serverUrl = "https://app.example.com";

    const audiences = buildValidAudiences(betterAuthUrl);
    const cliResource = cliResourceFromServerUrl(serverUrl);

    expect(audiences).toContain(cliResource);
  });
});
