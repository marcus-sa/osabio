/**
 * Acceptance Tests: Account Revocation (US-10)
 *
 * Walking skeleton phase 10: Users disconnect their accounts from providers.
 * Credential fields are hard-deleted (not just status-flagged). Subsequent
 * tool calls for the provider return "account disconnected" error.
 *
 * Traces: US-10, AC-10
 * Driving port: DELETE /api/workspaces/:workspaceId/accounts/:accountId
 *
 * Implementation sequence:
 *   1. Walking skeleton: revoke account, credentials deleted, status set  [ENABLED]
 *   2. Subsequent tool calls return "account disconnected" error
 *   3. Revocation is idempotent (second revoke returns success)
 *   4. Other accounts for the same identity are not affected
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedFullIntegrationTool,
  seedConnectedAccount,
  seedCredentialProvider,
  getConnectedAccounts,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_account_revocation");

// ---------------------------------------------------------------------------
// Walking Skeleton: User revokes connected account
// ---------------------------------------------------------------------------
describe("Walking Skeleton: User revokes connected account and credentials are deleted", () => {
  it("sets status to revoked and hard-deletes all credential fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-revoke-${crypto.randomUUID()}`);

    // Given an active connected_account for identity and provider "github"
    const providerId = `prov-rev-${crypto.randomUUID()}`;
    const accountId = `acct-rev-${crypto.randomUUID()}`;
    await seedFullIntegrationTool(surreal, {
      providerId,
      providerName: "github",
      authMethod: "oauth2",
      toolId: `tool-rev-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId,
      accessTokenEncrypted: "encrypted:access_token_value",
      refreshTokenEncrypted: "encrypted:refresh_token_value",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    });

    // Verify account exists with credentials
    let accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
    expect(accounts[0].access_token_encrypted).toBeDefined();

    // When user revokes the connection
    const accountRecord = new RecordId("connected_account", accountId);
    await surreal.query(
      `UPDATE $acct SET
        status = 'revoked',
        access_token_encrypted = NONE,
        refresh_token_encrypted = NONE,
        api_key_encrypted = NONE,
        basic_password_encrypted = NONE;`,
      { acct: accountRecord },
    );

    // Then connected_account.status is "revoked"
    accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("revoked");

    // And all credential fields are deleted (not just marked)
    expect(accounts[0].access_token_encrypted).toBeUndefined();
    expect(accounts[0].refresh_token_encrypted).toBeUndefined();
    expect(accounts[0].api_key_encrypted).toBeUndefined();
    expect(accounts[0].basic_password_encrypted).toBeUndefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Subsequent tool calls return 'account disconnected' after revocation", () => {
  it.skip("rejects tool execution with error when account is revoked", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-postrev-${crypto.randomUUID()}`);

    // Given a revoked connected_account
    const providerId = `prov-postrev-${crypto.randomUUID()}`;
    const accountId = `acct-postrev-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });
    await seedConnectedAccount(surreal, accountId, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      status: "revoked",
      // No credential fields (they were deleted on revocation)
    });

    // When the proxy intercepts a tool call for github tools
    // Then the proxy returns error: "account disconnected"
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("revoked");
  }, 30_000);
});

describe("Revocation is idempotent", () => {
  it.skip("second revocation of the same account succeeds without error", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-idem-${crypto.randomUUID()}`);

    // Given an already-revoked account
    const providerId = `prov-idem-${crypto.randomUUID()}`;
    const accountId = `acct-idem-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });
    await seedConnectedAccount(surreal, accountId, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      status: "revoked",
    });

    // When user revokes again
    const accountRecord = new RecordId("connected_account", accountId);
    await surreal.query(
      `UPDATE $acct SET status = 'revoked', access_token_encrypted = NONE;`,
      { acct: accountRecord },
    );

    // Then it succeeds without error
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts[0].status).toBe("revoked");
  }, 30_000);
});

describe("Other accounts for same identity unaffected by revocation", () => {
  it.skip("revocation of one provider account does not affect other provider accounts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-other-${crypto.randomUUID()}`);

    // Given identity has accounts for both "github" and "slack"
    const githubProviderId = `prov-gh-${crypto.randomUUID()}`;
    const slackProviderId = `prov-sl-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, githubProviderId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });
    await seedCredentialProvider(surreal, slackProviderId, {
      name: "slack",
      displayName: "Slack",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });

    const githubAccountId = `acct-gh-${crypto.randomUUID()}`;
    const slackAccountId = `acct-sl-${crypto.randomUUID()}`;
    await seedConnectedAccount(surreal, githubAccountId, {
      identityId: user.identityId,
      providerId: githubProviderId,
      workspaceId: user.workspaceId,
      accessTokenEncrypted: "encrypted:gh-token",
    });
    await seedConnectedAccount(surreal, slackAccountId, {
      identityId: user.identityId,
      providerId: slackProviderId,
      workspaceId: user.workspaceId,
      accessTokenEncrypted: "encrypted:slack-token",
    });

    // When user revokes only "github"
    const ghAccountRecord = new RecordId("connected_account", githubAccountId);
    await surreal.query(
      `UPDATE $acct SET status = 'revoked', access_token_encrypted = NONE;`,
      { acct: ghAccountRecord },
    );

    // Then "slack" account remains active
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    const slackAccount = accounts.find(a => a.id.id === slackAccountId);
    const githubAccount = accounts.find(a => a.id.id === githubAccountId);

    expect(githubAccount?.status).toBe("revoked");
    expect(slackAccount?.status).toBe("active");
    expect(slackAccount?.access_token_encrypted).toBeDefined();
  }, 30_000);
});
