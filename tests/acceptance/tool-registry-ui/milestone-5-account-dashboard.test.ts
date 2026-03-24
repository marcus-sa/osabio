/**
 * Milestone 5: Connected Accounts Dashboard
 *
 * Traces: US-UI-07 (accounts dashboard)
 *
 * Tests the account lifecycle endpoints that power the Accounts tab.
 * Covers listing accounts with status, revoking active accounts
 * (with permanent credential deletion), and reconnecting after revocation.
 *
 * Driving ports:
 *   GET    /api/workspaces/:wsId/accounts              (list accounts)
 *   DELETE /api/workspaces/:wsId/accounts/:accountId    (revoke account)
 *   POST   /api/workspaces/:wsId/accounts/connect/:pid  (reconnect)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  listAccounts,
  revokeAccount,
  connectAccount,
  seedProvider,
  seedAccount,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_account_dashboard");

// ---------------------------------------------------------------------------
// Happy Path: Account Listing with Mixed Statuses
// ---------------------------------------------------------------------------
describe("Member views connected accounts dashboard", () => {
  it("lists accounts with mixed statuses from different providers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-dash-${crypto.randomUUID()}`);

    // Given three accounts with different statuses
    const { providerId: p1 } = await seedProvider(surreal, member.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
    });
    const { providerId: p2 } = await seedProvider(surreal, member.workspaceId, {
      name: "slack",
      displayName: "Slack",
      authMethod: "oauth2",
    });
    const { providerId: p3 } = await seedProvider(surreal, member.workspaceId, {
      name: "legacy",
      displayName: "Legacy Service",
      authMethod: "basic",
    });

    await seedAccount(surreal, {
      identityId: member.identityId,
      providerId: p1,
      workspaceId: member.workspaceId,
      status: "active",
      accessTokenEncrypted: "encrypted:github-token",
    });
    await seedAccount(surreal, {
      identityId: member.identityId,
      providerId: p2,
      workspaceId: member.workspaceId,
      status: "active",
      accessTokenEncrypted: "encrypted:slack-token",
    });
    await seedAccount(surreal, {
      identityId: member.identityId,
      providerId: p3,
      workspaceId: member.workspaceId,
      status: "expired",
      basicUsername: "carlos",
      basicPasswordEncrypted: "encrypted:old-password",
    });

    // When member lists their accounts
    const res = await listAccounts(baseUrl, member, member.workspaceId);

    // Then all three accounts are returned with their statuses
    expect(res.status).toBe(200);
    const body = await res.json() as { accounts: Array<{ status: string; provider_id: string }> };
    expect(body.accounts.length).toBe(3);

    const statuses = body.accounts.map((a) => a.status);
    expect(statuses).toContain("active");
    expect(statuses).toContain("expired");
  }, 60_000);

  it("returns empty list when member has no connected accounts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-noacct-${crypto.randomUUID()}`);

    // Given member has no connected accounts
    const res = await listAccounts(baseUrl, member, member.workspaceId);

    // Then empty accounts list is returned (empty state data)
    expect(res.status).toBe(200);
    const body = await res.json() as { accounts: Array<unknown> };
    expect(body.accounts.length).toBe(0);
  }, 60_000);

  it("only returns accounts for the authenticated identity", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member1 = await createTestUserWithMcp(baseUrl, surreal, `ws-iso1-${crypto.randomUUID()}`);
    const member2 = await createTestUserWithMcp(
      baseUrl, surreal, `ws-iso2-${crypto.randomUUID()}`,
      { workspaceId: member1.workspaceId },
    );

    const { providerId } = await seedProvider(surreal, member1.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "api_key",
    });

    // Given member1 has an account
    await seedAccount(surreal, {
      identityId: member1.identityId,
      providerId,
      workspaceId: member1.workspaceId,
      apiKeyEncrypted: "encrypted:key1",
    });

    // When member2 lists their accounts
    const res = await listAccounts(baseUrl, member2, member1.workspaceId);

    // Then member2 sees no accounts (isolation by identity)
    expect(res.status).toBe(200);
    const body = await res.json() as { accounts: Array<unknown> };
    expect(body.accounts.length).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Account Revocation
// ---------------------------------------------------------------------------
describe("Member revokes connected account", () => {
  it("revokes active account and status changes to revoked", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-revoke-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "api_key",
    });

    const { accountId } = await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      apiKeyEncrypted: "encrypted:my-api-key",
    });

    // When member revokes the account
    const revokeRes = await revokeAccount(baseUrl, member, member.workspaceId, accountId);

    // Then the revocation succeeds
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json() as { status: string };
    expect(revokeBody.status).toBe("revoked");

    // And the account shows as revoked in the list
    const listRes = await listAccounts(baseUrl, member, member.workspaceId);
    const listBody = await listRes.json() as { accounts: Array<{ id: string; status: string }> };
    const revoked = listBody.accounts.find((a) => a.id === accountId);
    expect(revoked).toBeDefined();
    expect(revoked!.status).toBe("revoked");
  }, 60_000);

  it("permanently deletes encrypted credentials on revocation", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-creds-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    const { accountId } = await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      apiKeyEncrypted: "encrypted:sensitive-key",
    });

    // When member revokes the account
    await revokeAccount(baseUrl, member, member.workspaceId, accountId);

    // Then the encrypted credentials are permanently deleted from the database
    const accountRecord = new RecordId("connected_account", accountId);
    const rows = await surreal.query(
      `SELECT api_key_encrypted FROM $account;`,
      { account: accountRecord },
    ) as Array<Array<{ api_key_encrypted?: string }>>;

    const dbAccount = rows[0]?.[0];
    expect(dbAccount).toBeDefined();
    // Credential should be null/undefined after hard deletion
    expect(dbAccount!.api_key_encrypted).toBeFalsy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Account dashboard error paths", () => {
  it("returns 404 when revoking nonexistent account", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-notfound-${crypto.randomUUID()}`);

    const res = await revokeAccount(baseUrl, member, member.workspaceId, "nonexistent-account-id");

    expect(res.status).toBe(404);
  }, 60_000);

  it("revocation is idempotent for already-revoked account", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-idem-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "api_key",
    });

    const { accountId } = await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      status: "revoked",
    });

    // When member revokes an already-revoked account
    const res = await revokeAccount(baseUrl, member, member.workspaceId, accountId);

    // Then it succeeds idempotently
    expect(res.status).toBe(200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Reconnect After Revocation
// ---------------------------------------------------------------------------
describe("Member reconnects after revocation", () => {
  it("can connect new account after previous one was revoked", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-recon-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    // Given member had an account that was revoked
    const { accountId } = await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      status: "revoked",
    });

    // When member connects with new credentials
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      api_key: "new-api-key-after-revocation",
    });

    // Then a new active account is created
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; has_api_key: boolean };
    expect(body.status).toBe("active");
    expect(body.has_api_key).toBe(true);
  }, 60_000);
});
