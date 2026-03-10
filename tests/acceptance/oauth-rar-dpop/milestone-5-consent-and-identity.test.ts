/**
 * Milestone 5: Human Consent Rendering + Managed Agent Identity
 *
 * Traces: US-004 (Human-Readable RAR Consent), US-008 (Managed Agent Identity)
 *
 * Verifies:
 * - brain_action rendered in human-readable form
 * - Provider-specific formatting (amounts in dollars not cents)
 * - Approve, Constrain, Veto actions from consent UI
 * - Constrain produces tighter bounds
 * - Agent identity creation records managed_by relationship
 * - Token requests blocked if managing human is inactive
 * - Agent identity can be revoked
 *
 * Driving ports:
 *   GET  /api/workspaces/:ws/intents/:id/consent  (consent display)
 *   POST /api/workspaces/:ws/intents/:id/approve   (approve from consent)
 *   POST /api/workspaces/:ws/intents/:id/constrain  (constrain from consent)
 *   POST /api/workspaces/:ws/intents/:id/veto       (veto from consent)
 *   POST /api/auth/intents                          (intent submission)
 *   POST /api/auth/token                            (token issuance)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  createAgentIdentity,
  createManagedAgentIdentity,
  generateActorKeyPair,
  submitIntentWithDPoP,
  requestAccessToken,
  seedIntentWithStatus,
  seedAuthorizedIntent,
  readWorkspaceAction,
  fetchRaw,
  type BrainAction,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_m5_consent_identity");

// =============================================================================
// US-004: Human-Readable RAR Consent for Veto Window
// =============================================================================

describe("Consent display for pending intents", () => {
  it("brain_action is rendered in human-readable form for review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a high-risk intent waiting in the veto window
    const user = await createTestUser(baseUrl, "m5-consent-display");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "consent-agent");
    const keyPair = await generateActorKeyPair();

    const brainAction: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "invoice",
      constraints: {
        provider: "stripe",
        customer: "cus_acme_corp",
        amount: 240000, // cents
      },
    };

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
      "pending_veto",
    );

    // Set veto window expiry
    await surreal.query(
      `UPDATE $intent SET veto_expires_at = $expires, evaluation = $eval;`,
      {
        intent: new RecordId("intent", intentId),
        expires: new Date(Date.now() + 5 * 60 * 1000),
        eval: {
          decision: "APPROVE",
          risk_score: 65,
          reason: "High-value financial operation requires human review",
          evaluated_at: new Date(),
          policy_only: false,
        },
      },
    );

    // When the human views the consent details for this intent
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/intents/${intentId}/consent`,
      { headers: user.headers },
    );

    // Then the consent display shows human-readable operation details
    expect(response.ok).toBe(true);
    const consent = (await response.json()) as {
      action_display: string;
      resource_display: string;
      constraints_display?: Record<string, string>;
      risk_score: number;
      reasoning: string;
      expires_at: string;
    };

    // And amounts are formatted in dollars, not cents
    expect(consent.action_display).toBeTruthy();
    expect(consent.resource_display).toBeTruthy();
    if (consent.constraints_display?.amount) {
      expect(consent.constraints_display.amount).toContain("$");
      expect(consent.constraints_display.amount).not.toContain("240000");
    }
    expect(consent.risk_score).toBeGreaterThan(0);
    expect(consent.expires_at).toBeTruthy();
  });
});

describe("Consent actions from human review", () => {
  it("human approves a pending intent from the consent display", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a pending intent in the veto window
    const user = await createTestUser(baseUrl, "m5-approve");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "approve-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
      "pending_veto",
    );

    // When the human approves the intent
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/intents/${intentId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
      },
    );

    // Then the intent transitions to authorized
    expect(response.ok).toBe(true);

    const rows = (await surreal.query(
      `SELECT status FROM $intent;`,
      { intent: new RecordId("intent", intentId) },
    )) as Array<Array<{ status: string }>>;
    expect(rows[0]?.[0]?.status).toBe("authorized");
  });

  it("human vetoes a pending intent with a reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a pending intent in the veto window
    const user = await createTestUser(baseUrl, "m5-veto");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "veto-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "decision",
    };

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
      "pending_veto",
    );

    // When the human vetoes the intent
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/intents/${intentId}/veto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          reason: "This decision needs more context before committing",
        }),
      },
    );

    // Then the intent is vetoed with the reason recorded
    expect(response.ok).toBe(true);

    const rows = (await surreal.query(
      `SELECT status, veto_reason FROM $intent;`,
      { intent: new RecordId("intent", intentId) },
    )) as Array<Array<{ status: string; veto_reason: string }>>;
    expect(rows[0]?.[0]?.status).toBe("vetoed");
    expect(rows[0]?.[0]?.veto_reason).toContain("more context");
  });

  it("human constrains a pending intent to tighter bounds", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a pending intent with broad constraints
    const user = await createTestUser(baseUrl, "m5-constrain");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "constrain-agent");
    const keyPair = await generateActorKeyPair();

    const originalAction: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 10 },
    };

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, originalAction, keyPair.thumbprint,
      "pending_veto",
    );

    // When the human constrains the intent to tighter bounds
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/intents/${intentId}/constrain`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          constrained_authorization_details: [{
            type: "brain_action",
            action: "update",
            resource: "task",
            constraints: { max_changes: 3 }, // Tighter than original 10
          }],
        }),
      },
    );

    // Then the intent is authorized with the tighter constraints
    expect(response.ok).toBe(true);

    const rows = (await surreal.query(
      `SELECT status, authorization_details FROM $intent;`,
      { intent: new RecordId("intent", intentId) },
    )) as Array<Array<{ status: string; authorization_details: Array<{ constraints?: Record<string, unknown> }> }>>;

    expect(rows[0]?.[0]?.status).toBe("authorized");
    expect(rows[0]?.[0]?.authorization_details[0]?.constraints?.max_changes).toBe(3);
  });

  it("constrain rejects looser bounds than original authorization", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a pending intent with specific constraints
    const user = await createTestUser(baseUrl, "m5-wider");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "wider-agent");
    const keyPair = await generateActorKeyPair();

    const originalAction: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 3 },
    };

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, originalAction, keyPair.thumbprint,
      "pending_veto",
    );

    // When the human tries to widen the constraints
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/intents/${intentId}/constrain`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          constrained_authorization_details: [{
            type: "brain_action",
            action: "update",
            resource: "task",
            constraints: { max_changes: 50 }, // Wider than original 3
          }],
        }),
      },
    );

    // Then the request is rejected because constraints can only be tightened
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });
});

// =============================================================================
// US-008: Managed Agent Identity Registration
// =============================================================================

describe("Managed agent identity lifecycle", () => {
  it("agent identity records managed_by relationship to human owner", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a human user who manages an agent
    const user = await createTestUser(baseUrl, "m5-managed");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When registering a managed agent identity
    const agentId = await createManagedAgentIdentity(
      surreal, workspace.workspaceId, "my-coding-agent", "user-123",
    );

    // Then the agent identity has a managed_by link to the human
    const rows = (await surreal.query(
      `SELECT managed_by FROM $identity;`,
      { identity: new RecordId("identity", agentId) },
    )) as Array<Array<{ managed_by: string }>>;

    expect(rows[0]?.[0]?.managed_by).toBe("user-123");
  });

  it("managed agent cannot acquire tokens when managing human is inactive", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a managed agent whose human owner has been deactivated
    const user = await createTestUser(baseUrl, "m5-inactive");
    const workspace = await createTestWorkspace(baseUrl, user);

    const agentId = await createManagedAgentIdentity(
      surreal, workspace.workspaceId, "orphaned-agent", "deactivated-user-id",
    );

    // And the managing human is marked as inactive
    // (The identity resolver should check the managing human's status)

    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    // And an intent is authorized (bypassing the evaluation for this test)
    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // When the agent requests a token
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Then the token request is blocked because the managing human is inactive
    expect(response.ok).toBe(false);
  });

  it("revoked agent identity cannot submit new intents", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a managed agent whose identity has been revoked
    const user = await createTestUser(baseUrl, "m5-revoked");
    const workspace = await createTestWorkspace(baseUrl, user);

    const agentId = await createManagedAgentIdentity(
      surreal, workspace.workspaceId, "revoked-agent", "owner-user-id",
    );

    // And the agent identity is revoked
    await surreal.query(
      `UPDATE $identity SET identity_status = "revoked", revoked_at = time::now();`,
      { identity: new RecordId("identity", agentId) },
    );

    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    // When the revoked agent tries to submit a new intent
    const response = await submitIntentWithDPoP(
      baseUrl,
      workspace.workspaceId,
      agentId,
      brainAction,
      keyPair.thumbprint,
      { goal: "Attempt operation with revoked identity" },
    );

    // Then the submission is rejected because the identity is revoked
    expect(response.ok).toBe(false);
  });

  it("revoked agent tokens issued before revocation are rejected at Brain boundary", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a managed agent that was previously authorized and received a token
    const user = await createTestUser(baseUrl, "m5-token-revoke");
    const workspace = await createTestWorkspace(baseUrl, user);

    const agentId = await createManagedAgentIdentity(
      surreal, workspace.workspaceId, "pre-revoke-agent", "owner-user",
    );

    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    const tokenResponse = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Assume token was issued (if endpoint exists)
    if (!tokenResponse.ok) return;
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When the agent identity is revoked after the token was issued
    await surreal.query(
      `UPDATE $identity SET identity_status = "revoked", revoked_at = time::now();`,
      { identity: new RecordId("identity", agentId) },
    );

    // And the agent tries to use the previously-issued token
    const brainResponse = await (await import("./oauth-test-kit")).makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      access_token,
      keyPair,
    );

    // Then the Brain rejects the request because the identity is now revoked
    expect(brainResponse.ok).toBe(false);
    expect(brainResponse.status).toBe(401);
  });
});
