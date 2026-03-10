/**
 * Unit tests for MCP route DPoP + RAR auth migration.
 *
 * Verifies that authenticateAndAuthorize:
 * 1. Delegates to authenticateDPoPRequest for token/proof verification
 * 2. Derives BrainAction from HTTP method + path via deriveRequestedAction
 * 3. Verifies operation scope via verifyOperationScope against token's authorization_details
 * 4. Returns DPoPAuthResult on success
 * 5. Returns error Response on DPoP failure, missing route mapping, or insufficient authorization
 *
 * Step-ID: 03-04
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { authenticateAndAuthorize } from "../../../app/src/server/mcp/mcp-dpop-auth";
import type { DPoPAuthResult, BrainAction } from "../../../app/src/server/oauth/types";
import type { DPoPVerificationDeps } from "../../../app/src/server/oauth/dpop-middleware";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_WORKSPACE_ID = "ws-dpop-test";
const TEST_WORKSPACE_NAME = "DPoP Test";
const TEST_IDENTITY_ID = "id-dpop-test";

function makeDPoPAuthResult(overrides?: Partial<DPoPAuthResult>): DPoPAuthResult {
  return {
    workspaceRecord: new RecordId("workspace", TEST_WORKSPACE_ID),
    workspaceName: TEST_WORKSPACE_NAME,
    identityRecord: new RecordId("identity", TEST_IDENTITY_ID),
    actorType: "agent",
    authorizationDetails: [
      { type: "brain_action", action: "read", resource: "workspace" },
      { type: "brain_action", action: "read", resource: "project" },
      { type: "brain_action", action: "create", resource: "decision" },
    ],
    intentId: "intent-test",
    dpopThumbprint: "thumb-test",
    ...overrides,
  };
}

function buildRequest(method: string, path: string): Request {
  return new Request(`https://brain.local${path}`, { method });
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Stub DPoP middleware that succeeds with a given auth result. */
function stubDPoPSuccess(result: DPoPAuthResult) {
  return async (_request: Request, _deps: DPoPVerificationDeps): Promise<DPoPAuthResult | Response> => result;
}

/** Stub DPoP middleware that fails with 401. */
function stubDPoPFailure(error: string, status = 401) {
  return async (_request: Request, _deps: DPoPVerificationDeps): Promise<DPoPAuthResult | Response> =>
    new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authenticateAndAuthorize", () => {
  const dummyDeps = {} as DPoPVerificationDeps;

  it("returns DPoPAuthResult when DPoP succeeds and RAR matches", async () => {
    const authResult = makeDPoPAuthResult({
      authorizationDetails: [
        { type: "brain_action", action: "read", resource: "workspace" },
      ],
    });
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/workspace-context`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPSuccess(authResult),
    );

    expect(result).not.toBeInstanceOf(Response);
    const auth = result as DPoPAuthResult;
    expect(auth.workspaceRecord.id).toBe(TEST_WORKSPACE_ID);
    expect(auth.workspaceName).toBe(TEST_WORKSPACE_NAME);
    expect(auth.actorType).toBe("agent");
  });

  it("propagates DPoP middleware error as Response", async () => {
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/workspace-context`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPFailure("dpop_required"),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("dpop_required");
  });

  it("returns 403 when route action not authorized by token", async () => {
    // Token only has "read:workspace", but route requires "create:decision"
    const authResult = makeDPoPAuthResult({
      authorizationDetails: [
        { type: "brain_action", action: "read", resource: "workspace" },
      ],
    });
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/decisions/provisional`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPSuccess(authResult),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("authorization_details_mismatch");
  });

  it("returns 403 when route has no action mapping", async () => {
    const authResult = makeDPoPAuthResult();
    // Use an unmapped route path
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/unknown-endpoint`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPSuccess(authResult),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("unmapped_route");
  });

  it("verifies human actor type is preserved from DPoP result", async () => {
    const authResult = makeDPoPAuthResult({
      actorType: "human",
      authorizationDetails: [
        { type: "brain_action", action: "read", resource: "project" },
      ],
    });
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/project-context`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPSuccess(authResult),
    );

    expect(result).not.toBeInstanceOf(Response);
    const auth = result as DPoPAuthResult;
    expect(auth.actorType).toBe("human");
  });

  it("allows create:task action for subtask route", async () => {
    const authResult = makeDPoPAuthResult({
      authorizationDetails: [
        { type: "brain_action", action: "create", resource: "task" },
      ],
    });
    const request = buildRequest("POST", `/api/mcp/${TEST_WORKSPACE_ID}/tasks/subtask`);

    const result = await authenticateAndAuthorize(
      request,
      dummyDeps,
      stubDPoPSuccess(authResult),
    );

    expect(result).not.toBeInstanceOf(Response);
    const auth = result as DPoPAuthResult;
    expect(auth.workspaceRecord.id).toBe(TEST_WORKSPACE_ID);
  });
});
