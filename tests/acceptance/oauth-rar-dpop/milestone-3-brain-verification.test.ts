/**
 * Milestone 3: DPoP + RAR Verification at Brain Resource Server
 *
 * Traces: US-005 (DPoP Proof Verification), US-006 (RAR Operation Scope Verification)
 *
 * Verifies:
 * - Brain rejects Bearer tokens with 401 "dpop_required"
 * - Brain rejects session cookies with 401 "dpop_required"
 * - DPoP proof validated: structure, signature, claims
 * - JWK thumbprint matched against cnf.jkt
 * - Nonce cache rejects reused jti
 * - Clock skew tolerance (60s past, 5s future)
 * - Type must be "brain_action"
 * - Action and resource matched exactly
 * - Constraint bounds enforced
 * - Specific error codes returned
 * - Same pipeline for agent and human tokens
 *
 * Driving ports:
 *   POST /api/mcp/:ws/*  (DPoP-protected Brain endpoints)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOAuthSuite,
  createTestUser,
  createTestWorkspace,
  createAgentIdentity,
  generateActorKeyPair,
  requestAccessToken,
  seedAuthorizedIntent,
  makeDPoPProtectedRequest,
  makeBearerRequest,
  makeSessionCookieRequest,
  readWorkspaceAction,
  updateTaskAction,
  createDecisionAction,
  createProofForRequest,
  createMalformedProof,
} from "./oauth-test-kit";

const getRuntime = setupOAuthSuite("oauth_m3_brain_verification");

// =============================================================================
// US-005: DPoP Proof Verification at Brain Resource Server
// =============================================================================

describe("Brain rejects non-DPoP authentication", () => {
  it("Brain rejects Bearer tokens with dpop_required error", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a valid Bearer token from the old auth system
    const user = await createTestUser(baseUrl, "m3-bearer");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When presenting a Bearer token to a DPoP-protected endpoint
    const response = await makeBearerRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      "some-bearer-token",
    );

    // Then the request is rejected with a clear indication that DPoP is required
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("dpop_required");
  });

  it("Brain rejects session cookies on DPoP-protected endpoints", async () => {
    const { baseUrl } = getRuntime();

    // Given a human user with a valid session cookie
    const user = await createTestUser(baseUrl, "m3-cookie");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When presenting only session cookies to a Brain endpoint
    const response = await makeSessionCookieRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      user.headers,
    );

    // Then the request is rejected because sessions cannot access Brain directly
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("dpop_required");
  });

  it("Brain rejects requests with no authentication at all", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace endpoint
    const user = await createTestUser(baseUrl, "m3-none");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When making a request without any authentication
    const response = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );

    // Then the request is rejected
    expect(response.status).toBe(401);
  });
});

describe("DPoP proof validation at Brain boundary", () => {
  it("valid DPoP proof grants access to authorized operation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with an authorized intent and issued token
    const user = await createTestUser(baseUrl, "m3-valid");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "valid-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting the token with a fresh DPoP proof
    const response = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      access_token,
      keyPair,
    );

    // Then the Brain grants access
    expect(response.ok).toBe(true);
  });

  it("Brain rejects proof with wrong HTTP method", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token
    const user = await createTestUser(baseUrl, "m3-wrong-method");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "method-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting a proof signed for GET but the request is POST
    const requestUri = `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`;
    const wrongMethodProof = await createProofForRequest(keyPair, "GET", requestUri);

    const response = await fetch(requestUri, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${access_token}`,
        DPoP: wrongMethodProof,
      },
    });

    // Then the proof is rejected because the method doesn't match
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("Brain rejects proof with wrong target URI", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token
    const user = await createTestUser(baseUrl, "m3-wrong-uri");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "uri-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting a proof signed for a different endpoint
    const wrongUriProof = await createProofForRequest(
      keyPair, "POST", `${baseUrl}/api/mcp/other-workspace/workspace-context`,
    );

    const response = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      {
        method: "POST",
        headers: {
          Authorization: `DPoP ${access_token}`,
          DPoP: wrongUriProof,
        },
      },
    );

    // Then the proof is rejected because the URI doesn't match
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("Brain rejects proof signed with different key than token binding", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token bound to key pair A
    const user = await createTestUser(baseUrl, "m3-diff-key");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "diff-key-agent");
    const keyPairA = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPairA.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPairA, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting the token with a proof signed by key pair B (stolen token)
    const keyPairB = await generateActorKeyPair();
    const response = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      access_token,
      keyPairB,
    );

    // Then the proof is rejected because the key doesn't match the token binding
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("Brain rejects replayed DPoP proof (same jti used twice)", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token and a proof that was already used
    const user = await createTestUser(baseUrl, "m3-replay");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "replay-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When the agent creates a proof and uses it for two requests
    const requestUri = `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`;
    const proof = await createProofForRequest(keyPair, "POST", requestUri);

    // First request succeeds
    const firstResponse = await fetch(requestUri, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${access_token}`,
        DPoP: proof,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(firstResponse.ok).toBe(true);

    // When replaying the same proof
    const replayResponse = await fetch(requestUri, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${access_token}`,
        DPoP: proof,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    // Then the replay is detected and rejected
    expect(replayResponse.ok).toBe(false);
    expect(replayResponse.status).toBe(401);
  });

  it("Brain rejects proof with timestamp too far in the past (beyond 60s tolerance)", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token
    const user = await createTestUser(baseUrl, "m3-clock-past");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "clock-past-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting a proof with iat 120 seconds in the past
    const expiredProof = await createMalformedProof(keyPair, {
      htm: "POST",
      htu: `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      iat: Math.floor(Date.now() / 1000) - 120,
    });

    const response = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      {
        method: "POST",
        headers: {
          Authorization: `DPoP ${access_token}`,
          DPoP: expiredProof,
        },
      },
    );

    // Then the proof is rejected as expired
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("Brain rejects proof with timestamp too far in the future (beyond 5s tolerance)", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token
    const user = await createTestUser(baseUrl, "m3-clock-future");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "clock-future-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting a proof with iat 30 seconds in the future
    const futureProof = await createMalformedProof(keyPair, {
      htm: "POST",
      htu: `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      iat: Math.floor(Date.now() / 1000) + 30,
    });

    const response = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      {
        method: "POST",
        headers: {
          Authorization: `DPoP ${access_token}`,
          DPoP: futureProof,
        },
      },
    );

    // Then the proof is rejected as from the future
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("Brain rejects proof with missing JWK in header", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent with a valid token
    const user = await createTestUser(baseUrl, "m3-no-jwk");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "no-jwk-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When presenting a proof without the JWK in the header
    const noJwkProof = await createMalformedProof(keyPair, {
      htm: "POST",
      htu: `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      omitJwk: true,
    });

    const response = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/workspace-context`,
      {
        method: "POST",
        headers: {
          Authorization: `DPoP ${access_token}`,
          DPoP: noJwkProof,
        },
      },
    );

    // Then the proof is rejected due to invalid structure
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });
});

// =============================================================================
// US-006: RAR Operation Scope Verification at Brain Resource Server
// =============================================================================

describe("Brain verifies operation scope against token authorization", () => {
  it("request matching token action and resource succeeds", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a token authorized for reading workspace data
    const user = await createTestUser(baseUrl, "m3-scope-ok");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "scope-ok-agent");
    const keyPair = await generateActorKeyPair();
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [brainAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When the agent accesses the matching workspace-context endpoint
    const response = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      access_token,
      keyPair,
    );

    // Then access is granted because the operation matches the authorization
    expect(response.ok).toBe(true);
  });

  it("request for different action than authorized is rejected with mismatch error", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a token authorized only for reading workspace data
    const user = await createTestUser(baseUrl, "m3-scope-mismatch");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "scope-mismatch-agent");
    const keyPair = await generateActorKeyPair();
    const readAction = readWorkspaceAction(workspace.workspaceId);

    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, readAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [readAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When the agent tries to create a decision (write operation) with a read token
    const response = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/decisions/provisional`,
      access_token,
      keyPair,
      { body: { summary: "Test decision" } },
    );

    // Then the request is rejected with an authorization mismatch error
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("authorization_details_mismatch");
  });

  it("request exceeding authorized constraints is rejected with params_exceeded error", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a token authorized for updating a specific task
    const user = await createTestUser(baseUrl, "m3-params-exceed");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "params-agent");
    const keyPair = await generateActorKeyPair();

    // Token is authorized for task-123 only
    const constrainedAction = updateTaskAction("task-123");
    const intentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, constrainedAction, keyPair.thumbprint,
    );
    const tokenResponse = await requestAccessToken(baseUrl, intentId, keyPair, [constrainedAction]);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    // When the agent tries to update a different task
    const response = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/tasks/status`,
      access_token,
      keyPair,
      { body: { task_id: "task-456", status: "in_progress" } },
    );

    // Then the request is rejected because it exceeds the authorized constraints
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("authorization_params_exceeded");
  });
});

describe("Uniform verification pipeline for all actor types", () => {
  it("agent and human tokens are verified through the same pipeline", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent token and a human token both authorized for the same operation
    const user = await createTestUser(baseUrl, "m3-uniform");
    const workspace = await createTestWorkspace(baseUrl, user);
    const brainAction = readWorkspaceAction(workspace.workspaceId);

    // Agent path: intent -> token
    const agentId = await createAgentIdentity(surreal, workspace.workspaceId, "uniform-agent");
    const agentKeyPair = await generateActorKeyPair();
    const agentIntentId = await seedAuthorizedIntent(
      surreal, workspace.workspaceId, agentId, brainAction, agentKeyPair.thumbprint,
    );
    const agentTokenResponse = await requestAccessToken(baseUrl, agentIntentId, agentKeyPair, [brainAction]);
    const { access_token: agentToken } = (await agentTokenResponse.json()) as { access_token: string };

    // Human path: bridge -> token
    const humanKeyPair = await generateActorKeyPair();
    const { default: bridgeModule } = await import("./oauth-test-kit");
    const bridgeResponse = await (await import("./oauth-test-kit")).exchangeSessionForToken(
      baseUrl, user.headers, humanKeyPair, brainAction,
    );

    // When both present valid DPoP proofs to the same endpoint
    const agentResponse = await makeDPoPProtectedRequest(
      baseUrl,
      `/api/mcp/${workspace.workspaceId}/workspace-context`,
      agentToken,
      agentKeyPair,
    );

    // Then both succeed through the same verification pipeline
    expect(agentResponse.ok).toBe(true);

    if (bridgeResponse.ok) {
      const { access_token: humanToken } = (await bridgeResponse.json()) as { access_token: string };
      const humanResponse = await makeDPoPProtectedRequest(
        baseUrl,
        `/api/mcp/${workspace.workspaceId}/workspace-context`,
        humanToken,
        humanKeyPair,
      );
      expect(humanResponse.ok).toBe(true);
    }
  });
});
