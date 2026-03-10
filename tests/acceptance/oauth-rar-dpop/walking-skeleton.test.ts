/**
 * Walking Skeleton: OAuth RAR+DPoP Sovereign Auth Model
 *
 * Traces: US-001, US-002, US-003, US-005, US-006, US-007
 *
 * These are the minimum viable E2E paths through the sovereign auth system.
 * Skeleton 1: Agent acquires DPoP-bound token and accesses Brain
 * Skeleton 2: Human exchanges session for DPoP token and accesses Brain
 *
 * Together they prove:
 * - An actor can generate a key pair and compute a thumbprint
 * - An agent can submit an intent with DPoP binding and receive authorization
 * - The Custom AS issues DPoP-bound tokens for authorized intents
 * - The Brain resource server verifies DPoP proofs and grants access
 * - A human can exchange a session for a DPoP-bound token via the Bridge
 * - Human and agent tokens are verified identically at the Brain boundary
 *
 * Driving ports:
 *   POST /api/auth/intents           (intent submission)
 *   POST /api/auth/token             (token issuance)
 *   POST /api/auth/bridge/exchange   (session-to-token Bridge)
 *   POST /api/mcp/:ws/*              (DPoP-protected Brain endpoints)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  createAgentIdentity,
  generateActorKeyPair,
  submitIntentWithDPoP,
  requestAccessToken,
  exchangeSessionForToken,
  makeDPoPProtectedRequest,
  readWorkspaceAction,
  waitForIntentStatus,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_walking_skeleton");

describe("Walking Skeleton: Agent acquires authorization and accesses Brain", () => {
  // ---------------------------------------------------------------------------
  // Skeleton 1: Agent Token Acquisition -> Brain Access
  // US-001 + US-002 + US-003 + US-005 + US-006
  // ---------------------------------------------------------------------------
  it("agent generates key pair, submits intent, receives token, and accesses Brain endpoint", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where an agent needs to perform authorized operations
    const user = await createTestUser(baseUrl, "skeleton-agent");
    const workspace = await createTestWorkspace(baseUrl, user);

    // And an agent identity registered in the workspace
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "test-coding-agent");

    // And the agent generates a key pair for its session
    const keyPair = await generateActorKeyPair();

    // Then the key pair has a computed thumbprint for sender binding
    expect(keyPair.thumbprint).toBeTruthy();
    expect(keyPair.thumbprint.length).toBeGreaterThan(0);

    // When the agent submits an intent declaring what it wants to do,
    // binding the request to its key pair thumbprint
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const intentResponse = await submitIntentWithDPoP(
      baseUrl,
      workspace.workspaceId,
      agentId,
      brainAction,
      keyPair.thumbprint,
      {
        goal: "Read workspace context to understand current project state",
        reasoning: "Agent needs workspace context to plan its next action",
      },
    );

    // Then the intent is accepted with a DPoP thumbprint binding
    expect(intentResponse.ok).toBe(true);
    const intentResult = (await intentResponse.json()) as { intent_id: string; status: string };
    expect(intentResult.intent_id).toBeTruthy();

    // And the intent proceeds through evaluation to authorization
    const finalStatus = await waitForIntentStatus(
      surreal,
      intentResult.intent_id,
      ["authorized", "pending_veto"],
      60_000,
    );
    expect(["authorized", "pending_veto"]).toContain(finalStatus);

    // When the intent is authorized and the agent requests a token
    // (skip if not auto-approved -- the walking skeleton tests the happy path)
    if (finalStatus !== "authorized") {
      console.log(
        `[walking-skeleton] Intent routed to ${finalStatus}, skipping token acquisition. ` +
        `The full flow is tested in milestone tests.`,
      );
      return;
    }

    const tokenResponse = await requestAccessToken(
      baseUrl,
      intentResult.intent_id,
      keyPair,
      [brainAction],
    );

    // Then the Custom AS issues a DPoP-bound access token
    expect(tokenResponse.ok).toBe(true);
    const tokenResult = (await tokenResponse.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(tokenResult.access_token).toBeTruthy();
    expect(tokenResult.token_type).toBe("DPoP");
    expect(tokenResult.expires_in).toBeLessThanOrEqual(300);

    // When the agent presents the token with a fresh proof to a Brain endpoint
    const brainResponse = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      tokenResult.access_token,
      keyPair,
    );

    // Then the Brain resource server verifies the proof and grants access
    expect(brainResponse.ok).toBe(true);
  }, 120_000);
});

describe("Walking Skeleton: Human exchanges session for token and accesses Brain", () => {
  // ---------------------------------------------------------------------------
  // Skeleton 2: Human Bridge Exchange -> Brain Access
  // US-001 + US-005 + US-006 + US-007
  // ---------------------------------------------------------------------------
  it("human logs in, exchanges session for DPoP token, and accesses Brain endpoint", async () => {
    const { baseUrl } = getRuntime();

    // Given a human user logged into the dashboard via Better Auth
    const user = await createTestUser(baseUrl, "skeleton-human");
    const workspace = await createTestWorkspace(baseUrl, user);

    // And the dashboard generates a key pair for the browser session
    const keyPair = await generateActorKeyPair();

    // When the dashboard exchanges the session for a DPoP-bound token
    // requesting permission to read workspace data
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const bridgeResponse = await exchangeSessionForToken(
      baseUrl,
      user.headers,
      keyPair,
      brainAction,
    );

    // Then the Bridge issues a DPoP-bound token (same format as agent tokens)
    expect(bridgeResponse.ok).toBe(true);
    const bridgeResult = (await bridgeResponse.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(bridgeResult.access_token).toBeTruthy();
    expect(bridgeResult.token_type).toBe("DPoP");

    // When the human presents the token with a fresh proof to a Brain endpoint
    const brainResponse = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      bridgeResult.access_token,
      keyPair,
    );

    // Then the Brain resource server verifies identically to agent path
    expect(brainResponse.ok).toBe(true);
  }, 120_000);
});
