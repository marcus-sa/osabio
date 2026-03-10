/**
 * Milestone 2: RAR Token Issuance with DPoP Binding
 *
 * Traces: US-003 (RAR Token Issuance with DPoP Binding)
 *
 * Verifies:
 * - Custom AS accepts grant_type=urn:brain:intent-authorization
 * - Token includes cnf.jkt, authorization_details, intent_id
 * - Token TTL is 300 seconds
 * - Rejected if intent not in "authorized" status
 * - Rejected if DPoP proof key doesn't match intent thumbprint
 * - Token re-issuance for expired tokens
 *
 * Driving ports:
 *   POST /api/auth/token  (Custom AS token endpoint)
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  createAgentIdentity,
  generateActorKeyPair,
  requestAccessToken,
  seedAuthorizedIntent,
  seedIntentWithStatus,
  readWorkspaceAction,
  createDecisionAction,
  createProofForRequest,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_m2_token_issuance");

// =============================================================================
// US-003: RAR Token Issuance with DPoP Binding
// =============================================================================

describe("Token issuance for authorized intents", () => {
  it("authorized intent receives DPoP-bound access token", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an agent that has an authorized intent
    const user = await createTestUser(baseUrl, "m2-issue");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "token-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // When the agent requests a token with a valid DPoP proof
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Then the Custom AS issues a DPoP-bound access token
    expect(response.ok).toBe(true);
    const result = (await response.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(result.token_type).toBe("DPoP");
    expect(result.access_token).toBeTruthy();
    expect(result.expires_in).toBeGreaterThan(0);
    expect(result.expires_in).toBeLessThanOrEqual(300);
  });

  it("issued token contains sender binding and authorization details", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent
    const user = await createTestUser(baseUrl, "m2-claims");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "claims-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // When the agent receives a token
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );
    expect(response.ok).toBe(true);
    const { access_token } = (await response.json()) as { access_token: string };

    // Then the token claims include sender binding (cnf.jkt)
    const decoded = jose.decodeJwt(access_token);
    const cnf = decoded.cnf as { jkt: string } | undefined;
    expect(cnf?.jkt).toBe(keyPair.thumbprint);

    // And the token contains the authorized brain_action
    const authDetails = decoded.authorization_details as Array<{ type: string; action: string; resource: string }>;
    expect(authDetails).toBeArray();
    expect(authDetails[0]?.type).toBe("brain_action");
    expect(authDetails[0]?.action).toBe("read");
    expect(authDetails[0]?.resource).toBe("workspace");

    // And the token links to the authorizing intent
    const intentClaim = decoded["urn:brain:intent_id"] as string;
    expect(intentClaim).toBe(intentId);
  });

  it("token has maximum TTL of 300 seconds", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent
    const user = await createTestUser(baseUrl, "m2-ttl");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "ttl-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // When the token is issued
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );
    expect(response.ok).toBe(true);
    const { access_token } = (await response.json()) as { access_token: string };

    // Then the token expires within 300 seconds
    const decoded = jose.decodeJwt(access_token);
    const ttl = (decoded.exp as number) - (decoded.iat as number);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(ttl).toBeGreaterThan(0);
  });
});

describe("Token issuance rejection for invalid requests", () => {
  it("token rejected when intent is not in authorized status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent that is still pending authorization
    const user = await createTestUser(baseUrl, "m2-pending");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "pending-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
      "pending_auth",
    );

    // When the agent requests a token before authorization completes
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Then the token request is rejected
    expect(response.ok).toBe(false);
    const error = (await response.json()) as { error: string };
    expect(error.error).toBeTruthy();
  });

  it("token rejected when intent has been vetoed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent that was vetoed by a human
    const user = await createTestUser(baseUrl, "m2-vetoed");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "vetoed-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = createDecisionAction();

    const intentId = await seedIntentWithStatus(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
      "vetoed",
    );

    // When the agent requests a token for the vetoed intent
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Then the request is rejected
    expect(response.ok).toBe(false);
  });

  it("token rejected when DPoP proof key does not match intent thumbprint", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent bound to one key pair
    const user = await createTestUser(baseUrl, "m2-mismatch");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "mismatch-agent");
    const originalKeyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, originalKeyPair.thumbprint,
    );

    // When a different key pair is used to request the token (stolen intent ID)
    const attackerKeyPair = await generateActorKeyPair();
    const response = await requestAccessToken(
      baseUrl, intentId, attackerKeyPair, [brainAction],
    );

    // Then the request is rejected because the proof key doesn't match
    expect(response.ok).toBe(false);
    const error = (await response.json()) as { error: string };
    expect(error.error).toBeTruthy();
  });

  it("token rejected when authorization_details do not match intent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent for a read operation
    const user = await createTestUser(baseUrl, "m2-scope-mismatch");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "scope-agent");
    const keyPair = await generateActorKeyPair();
    const readAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, readAction, keyPair.thumbprint,
    );

    // When the agent requests a token for a different action (privilege escalation)
    const writeAction = createDecisionAction();
    const response = await requestAccessToken(
      baseUrl, intentId, keyPair, [writeAction],
    );

    // Then the request is rejected due to authorization_details mismatch
    expect(response.ok).toBe(false);
  });

  it("token rejected for non-existent intent", async () => {
    const { baseUrl } = getRuntime();

    // Given a fabricated intent ID that does not exist
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction("fake-workspace");

    // When the agent requests a token for the non-existent intent
    const response = await requestAccessToken(
      baseUrl, "non-existent-intent-id", keyPair, [brainAction],
    );

    // Then the request is rejected
    expect(response.ok).toBe(false);
  });

  it("token rejected when DPoP proof is missing", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent
    const user = await createTestUser(baseUrl, "m2-no-proof");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "no-proof-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // When requesting a token without a DPoP proof header
    const response = await fetch(`${baseUrl}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:brain:intent-authorization",
        intent_id: intentId,
        authorization_details: [brainAction],
      }),
    });

    // Then the request is rejected because DPoP proof is required
    expect(response.ok).toBe(false);
  });
});

describe("Token re-issuance", () => {
  it("agent can request new token for same authorized intent after expiry", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authorized intent that has already been used to issue a token
    const user = await createTestUser(baseUrl, "m2-reissue");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "reissue-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );

    // And a first token was issued successfully
    const firstResponse = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );
    expect(firstResponse.ok).toBe(true);

    // When the agent requests a new token (e.g., after the first expired)
    const secondResponse = await requestAccessToken(
      baseUrl, intentId, keyPair, [brainAction],
    );

    // Then a new token is issued successfully
    expect(secondResponse.ok).toBe(true);
    const second = (await secondResponse.json()) as { access_token: string };
    expect(second.access_token).toBeTruthy();
  });
});
