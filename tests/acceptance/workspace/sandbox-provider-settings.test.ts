import { describe, expect, it } from "bun:test";
import { createTestUser, setupAcceptanceSuite } from "../acceptance-test-kit";
import { createWorkspaceViaHttp } from "../shared-fixtures";

type SettingsResponse = {
  enforcementMode: string;
  thresholds: { min_decisions: number; min_tasks: number };
  transitions: unknown[];
  sandboxProvider?: string;
};

const getRuntime = setupAcceptanceSuite("sandbox_provider_settings");

describe("Sandbox provider in workspace settings", () => {
  it("GET /settings omits sandboxProvider when not configured", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, crypto.randomUUID());
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal);

    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      { headers: user.headers },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as SettingsResponse;
    expect(body.sandboxProvider).toBeUndefined();
  }, 30_000);

  it("PUT /settings with valid sandboxProvider persists and returns it", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, crypto.randomUUID());
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal);

    // PUT sandboxProvider
    const putResponse = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ sandboxProvider: "local" }),
      },
    );

    expect(putResponse.ok).toBe(true);
    const putBody = (await putResponse.json()) as SettingsResponse;
    expect(putBody.sandboxProvider).toBe("local");

    // GET to confirm persistence
    const getResponse = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      { headers: user.headers },
    );

    expect(getResponse.ok).toBe(true);
    const getBody = (await getResponse.json()) as SettingsResponse;
    expect(getBody.sandboxProvider).toBe("local");
  }, 30_000);

  it("PUT /settings with invalid sandboxProvider returns 400", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, crypto.randomUUID());
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal);

    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ sandboxProvider: "invalid-provider" }),
      },
    );

    expect(response.status).toBe(400);
  }, 30_000);

  it("PUT /settings with only sandboxProvider (no enforcement fields) succeeds", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, crypto.randomUUID());
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal);

    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ sandboxProvider: "e2b" }),
      },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as SettingsResponse;
    expect(body.sandboxProvider).toBe("e2b");
  }, 30_000);
});
