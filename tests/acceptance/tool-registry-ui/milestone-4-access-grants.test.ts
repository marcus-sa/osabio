/**
 * Milestone 4: Tool Access Grants
 *
 * Traces: US-UI-05 (grant tool access)
 *
 * Tests the grant management endpoints that power the Access tab.
 * Covers grant creation with rate limits, grant listing, duplicate
 * detection, and grant count propagation to the tools list.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/tools/:toolId/grants   (create grant)
 *   GET  /api/workspaces/:wsId/tools/:toolId/grants    (list grants)
 *   GET  /api/workspaces/:wsId/tools                    (verify count)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  grantToolAccess,
  listToolGrants,
  listTools,
  seedTool,
  seedGrant,
  createIdentity,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_access_grants");

// ---------------------------------------------------------------------------
// Happy Path: Grant Creation
// ---------------------------------------------------------------------------
describe("Admin grants tool access to identities", () => {
  it.skip("grants access with rate limit and sees grant in list", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-grant-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const { identityId } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");

    // When admin grants access with a rate limit of 20 calls per hour
    const grantRes = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: identityId,
      max_calls_per_hour: 20,
    });

    // Then the grant is created
    expect(grantRes.status).toBe(201);

    // And the grant appears in the tool's grant list
    const listRes = await listToolGrants(baseUrl, admin, admin.workspaceId, toolId);
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as { grants: Array<{
      identity_name: string;
      max_calls_per_hour?: number;
      granted_at: string;
    }> };
    expect(body.grants.length).toBe(1);
    expect(body.grants[0].identity_name).toBe("coding-agent-1");
    expect(body.grants[0].max_calls_per_hour).toBe(20);
    expect(body.grants[0].granted_at).toBeTruthy();
  }, 60_000);

  it.skip("grants access without rate limit (unlimited)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-unlimit-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
    });

    const { identityId } = await createIdentity(surreal, admin.workspaceId, "review-agent");

    // When admin grants access without specifying rate limit
    const res = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: identityId,
    });

    expect(res.status).toBe(201);

    // Then the grant has no rate limit (unlimited)
    const listRes = await listToolGrants(baseUrl, admin, admin.workspaceId, toolId);
    const body = await listRes.json() as { grants: Array<{ max_calls_per_hour?: number }> };
    expect(body.grants[0].max_calls_per_hour).toBeUndefined();
  }, 60_000);

  it.skip("multiple identities can be granted access to the same tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-multi-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const { identityId: id1 } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");
    const { identityId: id2 } = await createIdentity(surreal, admin.workspaceId, "review-agent");

    // When admin grants access to two different identities
    await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, { identity_id: id1 });
    await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, { identity_id: id2 });

    // Then both grants appear
    const listRes = await listToolGrants(baseUrl, admin, admin.workspaceId, toolId);
    const body = await listRes.json() as { grants: Array<{ identity_name: string }> };
    expect(body.grants.length).toBe(2);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Grant Count Propagation
// ---------------------------------------------------------------------------
describe("Grant count reflects in tools list", () => {
  it.skip("tools list grant_count updates after new grants", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-count-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    // Given no grants initially
    const before = await listTools(baseUrl, admin, admin.workspaceId);
    const beforeBody = await before.json() as { tools: Array<{ grant_count: number }> };
    expect(beforeBody.tools[0].grant_count).toBe(0);

    // When admin grants access to one identity
    const { identityId } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");
    await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, { identity_id: identityId });

    // Then the tools list shows grant_count = 1
    const after = await listTools(baseUrl, admin, admin.workspaceId);
    const afterBody = await after.json() as { tools: Array<{ grant_count: number }> };
    expect(afterBody.tools[0].grant_count).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Grant creation validates input", () => {
  it.skip("rejects duplicate grant for same identity and tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-dup-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const { identityId } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");

    // Given identity already has access
    await seedGrant(surreal, identityId, toolId);

    // When admin tries to grant again
    const res = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: identityId,
    });

    // Then the duplicate is rejected with friendly message
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("already");
  }, 60_000);

  it.skip("rejects grant to nonexistent identity", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-noid-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const res = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: "nonexistent-identity-id",
    });

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("rejects grant to nonexistent tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-notool-${crypto.randomUUID()}`);

    const res = await grantToolAccess(baseUrl, admin, admin.workspaceId, "nonexistent-tool", {
      identity_id: admin.identityId,
    });

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("rejects grant without identity_id", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-noidfield-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const res = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: "",
    });

    expect(res.status).toBe(400);
  }, 60_000);
});
