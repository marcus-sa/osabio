/**
 * Milestone 1: DPoP Key Pair Lifecycle + Intent Submission with DPoP Binding
 *
 * Traces: US-001 (DPoP Key Pair Lifecycle), US-002 (Intent Submission with DPoP Binding)
 *
 * Verifies:
 * - ES256 key pair generation per actor session
 * - JWK thumbprint computation per RFC 7638
 * - Key pair reuse across operations in same session
 * - Intent submission requires dpop_jwk_thumbprint for all Brain operations
 * - Intent submission requires authorization_details with type "brain_action"
 * - Missing thumbprint is rejected
 * - Missing authorization_details is rejected
 * - Low-risk reads auto-approve
 *
 * Driving ports:
 *   POST /api/auth/intents  (intent submission)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  createAgentIdentity,
  generateActorKeyPair,
  computeKeyThumbprint,
  submitIntentWithDPoP,
  readWorkspaceAction,
  updateTaskAction,
  createDecisionAction,
  waitForIntentStatus,
  fetchRaw,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_m1_dpop_key_intent");

// =============================================================================
// US-001: DPoP Key Pair Lifecycle for All Actors
// =============================================================================

describe("DPoP key pair lifecycle", () => {
  it("actor generates an ES256 key pair with computable thumbprint", async () => {
    // Given an actor (agent or browser) starting a new session

    // When the actor generates a key pair
    const keyPair = await generateActorKeyPair();

    // Then the key pair includes a public key suitable for DPoP proofs
    expect(keyPair.publicJwk.kty).toBe("EC");
    expect(keyPair.publicJwk.crv).toBe("P-256");
    expect(keyPair.publicJwk.x).toBeTruthy();
    expect(keyPair.publicJwk.y).toBeTruthy();

    // And the thumbprint is a base64url-encoded SHA-256 hash
    expect(keyPair.thumbprint).toBeTruthy();
    expect(keyPair.thumbprint.length).toBeGreaterThan(20);
  });

  it("key pair generation completes within 50ms", async () => {
    // Given the need for responsive key generation in agent sandboxes

    // When timing the key generation
    const start = performance.now();
    await generateActorKeyPair();
    const elapsed = performance.now() - start;

    // Then generation completes within the performance budget
    expect(elapsed).toBeLessThan(50);
  });

  it("thumbprint is deterministic for the same public key", async () => {
    // Given a generated key pair
    const keyPair = await generateActorKeyPair();

    // When computing the thumbprint multiple times
    const thumbprint1 = await computeKeyThumbprint(keyPair.publicJwk);
    const thumbprint2 = await computeKeyThumbprint(keyPair.publicJwk);

    // Then the thumbprints are identical
    expect(thumbprint1).toBe(thumbprint2);

    // And match the pre-computed value
    expect(thumbprint1).toBe(keyPair.thumbprint);
  });

  it("different key pairs produce different thumbprints", async () => {
    // Given two actors each generating their own key pair
    const keyPair1 = await generateActorKeyPair();
    const keyPair2 = await generateActorKeyPair();

    // Then their thumbprints are distinct
    expect(keyPair1.thumbprint).not.toBe(keyPair2.thumbprint);
  });

  it("key pair is reusable across multiple operations in the same session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace and agent with a session key pair
    const user = await createTestUser(baseUrl, "m1-reuse");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "reuse-agent");
    const keyPair = await generateActorKeyPair();

    // When the agent submits two different intents using the same key pair
    const action1 = readWorkspaceAction(workspace.workspaceId);
    const action2 = createDecisionAction();

    const response1 = await submitIntentWithDPoP(
      baseUrl, workspace.workspaceId, agentId, action1, keyPair.thumbprint,
      { goal: "First operation in session" },
    );
    const response2 = await submitIntentWithDPoP(
      baseUrl, workspace.workspaceId, agentId, action2, keyPair.thumbprint,
      { goal: "Second operation in session" },
    );

    // Then both submissions succeed with the same thumbprint
    expect(response1.ok).toBe(true);
    expect(response2.ok).toBe(true);
  });
});

// =============================================================================
// US-002: Intent Submission with DPoP Thumbprint Binding
// =============================================================================

describe("Intent submission with DPoP thumbprint binding", () => {
  it("intent submitted with brain_action and thumbprint is accepted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a registered agent
    const user = await createTestUser(baseUrl, "m1-submit");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "submit-agent");
    const keyPair = await generateActorKeyPair();

    // When the agent submits an intent with authorization_details and DPoP binding
    const brainAction = updateTaskAction();
    const response = await submitIntentWithDPoP(
      baseUrl,
      workspace.workspaceId,
      agentId,
      brainAction,
      keyPair.thumbprint,
      {
        goal: "Update task status to in_progress",
        reasoning: "Agent is beginning work on the assigned task",
      },
    );

    // Then the intent is accepted
    expect(response.ok).toBe(true);
    const result = (await response.json()) as { intent_id: string; status: string };
    expect(result.intent_id).toBeTruthy();

    // And the thumbprint is stored in the intent record
    const rows = (await surreal.query(
      `SELECT dpop_jwk_thumbprint, authorization_details FROM intent WHERE id = $intent;`,
      { intent: new (await import("surrealdb")).RecordId("intent", result.intent_id) },
    )) as Array<Array<{ dpop_jwk_thumbprint: string; authorization_details: Array<{ type: string }> }>>;

    expect(rows[0]?.[0]?.dpop_jwk_thumbprint).toBe(keyPair.thumbprint);
    expect(rows[0]?.[0]?.authorization_details[0]?.type).toBe("brain_action");
  });

  it("intent submission without thumbprint is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace and agent
    const user = await createTestUser(baseUrl, "m1-no-thumb");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "no-thumb-agent");

    // When the agent submits an intent without a DPoP thumbprint
    const response = await fetch(`${baseUrl}/api/auth/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.workspaceId,
        identity_id: agentId,
        authorization_details: [readWorkspaceAction(workspace.workspaceId)],
        // dpop_jwk_thumbprint intentionally omitted
        goal: "Read workspace",
        reasoning: "Need context",
      }),
    });

    // Then the submission is rejected with a clear error
    expect(response.status).toBe(400);
    const error = (await response.json()) as { error: string };
    expect(error.error).toContain("thumbprint");
  });

  it("intent submission without authorization_details is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace and agent with a key pair
    const user = await createTestUser(baseUrl, "m1-no-auth");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "no-auth-agent");
    const keyPair = await generateActorKeyPair();

    // When the agent submits an intent without authorization_details
    const response = await fetch(`${baseUrl}/api/auth/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.workspaceId,
        identity_id: agentId,
        dpop_jwk_thumbprint: keyPair.thumbprint,
        // authorization_details intentionally omitted
        goal: "Read workspace",
        reasoning: "Need context",
      }),
    });

    // Then the submission is rejected
    expect(response.status).toBe(400);
  });

  it("intent with authorization_details type other than brain_action is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace and agent
    const user = await createTestUser(baseUrl, "m1-bad-type");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "bad-type-agent");
    const keyPair = await generateActorKeyPair();

    // When the agent submits an intent with wrong authorization_details type
    const response = await fetch(`${baseUrl}/api/auth/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.workspaceId,
        identity_id: agentId,
        dpop_jwk_thumbprint: keyPair.thumbprint,
        authorization_details: [{ type: "openid", scope: "email" }],
        goal: "Read workspace",
        reasoning: "Need context",
      }),
    });

    // Then the submission is rejected because only brain_action is accepted
    expect(response.status).toBe(400);
  });

  it("low-risk read intent auto-approves without human intervention", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an agent submitting a low-risk read operation
    const user = await createTestUser(baseUrl, "m1-auto-approve");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "reader-agent");
    const keyPair = await generateActorKeyPair();

    // When the agent submits a workspace read intent
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const response = await submitIntentWithDPoP(
      baseUrl,
      workspace.workspaceId,
      agentId,
      brainAction,
      keyPair.thumbprint,
      {
        goal: "Read workspace context for orientation",
        reasoning: "Read-only operation with no side effects",
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { intent_id: string };

    // Then the intent is auto-approved without entering the veto window
    const finalStatus = await waitForIntentStatus(
      surreal,
      result.intent_id,
      ["authorized"],
      60_000,
    );
    expect(finalStatus).toBe("authorized");
  }, 120_000);

  it("intent submission preserves authorization_details with constraints", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent submitting an intent with specific constraints
    const user = await createTestUser(baseUrl, "m1-constraints");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "constrained-agent");
    const keyPair = await generateActorKeyPair();

    // When the intent includes constraints on the operation
    const brainAction = updateTaskAction("task-123");
    const response = await submitIntentWithDPoP(
      baseUrl,
      workspace.workspaceId,
      agentId,
      brainAction,
      keyPair.thumbprint,
      { goal: "Update specific task status" },
    );

    // Then the constraints are preserved in the stored intent
    expect(response.ok).toBe(true);
    const result = (await response.json()) as { intent_id: string };

    const rows = (await surreal.query(
      `SELECT authorization_details FROM intent WHERE id = $intent;`,
      { intent: new (await import("surrealdb")).RecordId("intent", result.intent_id) },
    )) as Array<Array<{ authorization_details: Array<{ constraints?: Record<string, unknown> }> }>>;

    expect(rows[0]?.[0]?.authorization_details[0]?.constraints?.task_id).toBe("task-123");
  });
});
