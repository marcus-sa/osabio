import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";

const getRuntime = setupAcceptanceSuite("public-config", {
  configOverrides: { selfHosted: true, worktreeManagerEnabled: true },
});

describe("GET /config", () => {
  it("returns selfHosted and worktreeManagerEnabled booleans", async () => {
    const { baseUrl } = getRuntime();
    const response = await fetch(`${baseUrl}/config`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(body).toEqual({
      selfHosted: true,
      worktreeManagerEnabled: true,
    });
  });

  it("does not expose secrets or internal config", async () => {
    const { baseUrl } = getRuntime();
    const response = await fetch(`${baseUrl}/config`);
    const body = await response.json();

    // Must not contain any secret or internal configuration
    const forbiddenKeys = [
      "adminEmail",
      "adminPassword",
      "openRouterApiKey",
      "anthropicApiKey",
      "surrealPassword",
      "surrealUsername",
      "betterAuthSecret",
      "githubClientSecret",
      "githubWebhookSecret",
      "surrealUrl",
      "port",
    ];

    for (const key of forbiddenKeys) {
      expect(body).not.toHaveProperty(key);
    }

    // Only allowed keys
    const allowedKeys = ["selfHosted", "worktreeManagerEnabled"];
    expect(Object.keys(body).sort()).toEqual(allowedKeys.sort());
  });
});
