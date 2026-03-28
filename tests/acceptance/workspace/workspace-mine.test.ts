import { describe, expect, it } from "bun:test";
import { createTestUser, setupAcceptanceSuite } from "../acceptance-test-kit";
import { createWorkspaceViaHttp } from "../shared-fixtures";

type WorkspaceMineResponse = {
  workspaceId?: string;
  workspaceName?: string;
};

const getRuntime = setupAcceptanceSuite("workspace_mine");

describe("GET /api/workspaces/mine", () => {
  it("returns the user's workspace when identity_person and member_of edges exist", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "mine-linked");
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal);

    const response = await fetch(`${baseUrl}/api/workspaces/mine`, {
      headers: user.headers,
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as WorkspaceMineResponse;
    expect(body.workspaceId).toBe(workspace.workspaceId);
    expect(body.workspaceName).toBeTruthy();
  }, 30_000);

  it("returns 401 when no session is provided", async () => {
    const { baseUrl } = getRuntime();

    const response = await fetch(`${baseUrl}/api/workspaces/mine`);

    expect(response.status).toBe(401);
  }, 10_000);

  it("returns undefined workspaceId when user has no workspace membership", async () => {
    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "mine-orphan");

    const response = await fetch(`${baseUrl}/api/workspaces/mine`, {
      headers: user.headers,
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as WorkspaceMineResponse;
    expect(body.workspaceId).toBeUndefined();
  }, 30_000);
});
