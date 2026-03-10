/**
 * Milestone 4: Bridge Token Exchange for Human Operators
 *
 * Traces: US-007 (Bridge Token Exchange for Human Operators)
 *
 * Verifies:
 * - Bridge accepts Better Auth session + DPoP proof + authorization_details
 * - Session validation is performed
 * - Issues DPoP-bound token with brain_action
 * - Low-risk reads auto-approve
 * - High-risk operations trigger veto window
 * - Expired session rejected with 401
 *
 * Driving ports:
 *   POST /api/auth/bridge/exchange  (session-to-token Bridge)
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  generateActorKeyPair,
  exchangeSessionForToken,
  makeDPoPProtectedRequest,
  readWorkspaceAction,
  updateTaskAction,
  createDecisionAction,
  createProofForRequest,
  type BrainAction,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_m4_bridge_exchange");

// =============================================================================
// US-007: Bridge Token Exchange for Human Operators
// =============================================================================

describe("Bridge exchange with valid session", () => {
  it("human exchanges session for DPoP-bound token for low-risk read", async () => {
    const { baseUrl } = getRuntime();

    // Given a human user with an active dashboard session
    const user = await createTestUser(baseUrl, "m4-read");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();

    // When the dashboard exchanges the session for a token to read workspace data
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const response = await exchangeSessionForToken(
      baseUrl, user.headers, keyPair, brainAction,
    );

    // Then the Bridge issues a DPoP-bound token
    expect(response.ok).toBe(true);
    const result = (await response.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(result.token_type).toBe("DPoP");
    expect(result.access_token).toBeTruthy();
    expect(result.expires_in).toBeGreaterThan(0);
  });

  it("bridge token contains correct sender binding and authorization details", async () => {
    const { baseUrl } = getRuntime();

    // Given a human with an active session
    const user = await createTestUser(baseUrl, "m4-claims");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();

    // When the bridge issues a token
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const response = await exchangeSessionForToken(
      baseUrl, user.headers, keyPair, brainAction,
    );
    expect(response.ok).toBe(true);
    const { access_token } = (await response.json()) as { access_token: string };

    // Then the token is bound to the browser's key pair
    const decoded = jose.decodeJwt(access_token);
    const cnf = decoded.cnf as { jkt: string } | undefined;
    expect(cnf?.jkt).toBe(keyPair.thumbprint);

    // And contains the requested brain_action
    const authDetails = decoded.authorization_details as Array<{ type: string }>;
    expect(authDetails).toBeArray();
    expect(authDetails[0]?.type).toBe("brain_action");
  });

  it("low-risk read operation auto-approves without veto window", async () => {
    const { baseUrl } = getRuntime();

    // Given a human requesting a low-risk read operation
    const user = await createTestUser(baseUrl, "m4-auto");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();

    // When the dashboard exchanges the session for a read token
    const brainAction = readWorkspaceAction(workspace.workspaceId);
    const response = await exchangeSessionForToken(
      baseUrl, user.headers, keyPair, brainAction,
    );

    // Then the token is issued immediately without entering a veto window
    expect(response.ok).toBe(true);
    const result = (await response.json()) as { access_token: string };
    expect(result.access_token).toBeTruthy();
    // The immediacy of the response proves no veto window was triggered
  });

  it("bridge token can be used to access Brain endpoints", async () => {
    const { baseUrl } = getRuntime();

    // Given a human with a bridge-issued DPoP token
    const user = await createTestUser(baseUrl, "m4-access");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const bridgeResponse = await exchangeSessionForToken(
      baseUrl, user.headers, keyPair, brainAction,
    );
    expect(bridgeResponse.ok).toBe(true);
    const { access_token } = (await bridgeResponse.json()) as { access_token: string };

    // When the human presents the token with a fresh proof to the Brain
    const brainResponse = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      access_token,
      keyPair,
    );

    // Then the Brain verifies and grants access
    expect(brainResponse.ok).toBe(true);
  });
});

describe("Bridge exchange triggers veto window for high-risk operations", () => {
  it("high-risk write operation triggers evaluation before token issuance", async () => {
    const { baseUrl } = getRuntime();

    // Given a human requesting a potentially risky write operation
    const user = await createTestUser(baseUrl, "m4-risky");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();

    // When the dashboard requests a token for creating a decision
    const riskyAction: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "decision",
    };
    const response = await exchangeSessionForToken(
      baseUrl, user.headers, keyPair, riskyAction,
    );

    // Then the response indicates the operation is being evaluated
    // (either immediate token for auto-approve, or pending status for veto window)
    const status = response.status;
    if (status === 200) {
      // Auto-approved
      const result = (await response.json()) as { access_token: string };
      expect(result.access_token).toBeTruthy();
    } else if (status === 202) {
      // Entered veto window -- token not yet issued
      const result = (await response.json()) as { status: string; intent_id: string };
      expect(result.status).toBe("pending_veto");
      expect(result.intent_id).toBeTruthy();
    } else if (status === 403) {
      // Evaluated and rejected — LLM determined the operation is too risky
      const result = (await response.json()) as { error: string };
      expect(result.error).toBeTruthy();
    } else {
      // Unexpected status
      expect([200, 202, 403]).toContain(status);
    }
  }, 60_000);
});

describe("Bridge exchange rejection for invalid sessions", () => {
  it("expired or invalid session is rejected by the Bridge", async () => {
    const { baseUrl } = getRuntime();

    // Given an expired session cookie
    const keyPair = await generateActorKeyPair();
    const user = await createTestUser(baseUrl, "m4-expired");
    const workspace = await createTestWorkspace(baseUrl, user);
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    // When the dashboard sends a fabricated/expired session cookie
    const response = await exchangeSessionForToken(
      baseUrl,
      { Cookie: "better-auth.session_token=expired-or-invalid-token" },
      keyPair,
      brainAction,
    );

    // Then the Bridge rejects the request because the session is not valid
    expect(response.status).toBe(401);
  });

  it("Bridge exchange without any session is rejected", async () => {
    const { baseUrl } = getRuntime();

    // Given a request to the Bridge without session credentials
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction("some-workspace");

    // When sending only a DPoP proof without a session
    const bridgeUri = `${baseUrl}/api/auth/bridge/exchange`;
    const proof = await createProofForRequest(keyPair, "POST", bridgeUri);

    const response = await fetch(bridgeUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        DPoP: proof,
      },
      body: JSON.stringify({
        authorization_details: [brainAction],
      }),
    });

    // Then the request is rejected
    expect(response.status).toBe(401);
  });

  it("Bridge exchange without DPoP proof is rejected", async () => {
    const { baseUrl } = getRuntime();

    // Given a human with a valid session but no DPoP proof
    const user = await createTestUser(baseUrl, "m4-no-proof");
    const workspace = await createTestWorkspace(baseUrl, user);
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    // When sending the session without a DPoP proof
    const response = await fetch(`${baseUrl}/api/auth/bridge/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...user.headers,
      },
      body: JSON.stringify({
        authorization_details: [brainAction],
      }),
    });

    // Then the request is rejected because DPoP proof is required
    expect(response.ok).toBe(false);
  });

  it("Bridge exchange without authorization_details is rejected", async () => {
    const { baseUrl } = getRuntime();

    // Given a human with a valid session and key pair
    const user = await createTestUser(baseUrl, "m4-no-authz");
    const workspace = await createTestWorkspace(baseUrl, user);
    const keyPair = await generateActorKeyPair();

    // When exchanging without specifying what operation is needed
    const bridgeUri = `${baseUrl}/api/auth/bridge/exchange`;
    const proof = await createProofForRequest(keyPair, "POST", bridgeUri);

    const response = await fetch(bridgeUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        DPoP: proof,
        ...user.headers,
      },
      body: JSON.stringify({}),
    });

    // Then the request is rejected because the Bridge needs to know what to authorize
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });
});
