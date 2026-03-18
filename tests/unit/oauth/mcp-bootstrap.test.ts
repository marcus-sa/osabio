import { describe, expect, it } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import type { AsSigningKey } from "../../../app/src/server/oauth/as-key-management";
import type { BrainAction } from "../../../app/src/server/oauth/types";
import type { IntentStatus } from "../../../app/src/server/intent/types";
import { issueMcpBootstrapToken } from "../../../app/src/server/oauth/mcp-bootstrap";

const TEST_ACTIONS: BrainAction[] = [
  { type: "brain_action", action: "read", resource: "workspace" },
];

function makeIntent(status: IntentStatus) {
  return {
    id: new RecordId("intent", "intent-1"),
    goal: "goal",
    reasoning: "reasoning",
    status,
    priority: 0,
    action_spec: { provider: "brain", action: "read", params: { resource: "workspace" } },
    trace_id: new RecordId("trace", "trace-1"),
    requester: new RecordId("identity", "identity-1"),
    workspace: new RecordId("workspace", "workspace-1"),
    created_at: new Date("2026-03-19T00:00:00.000Z"),
  };
}

describe("issueMcpBootstrapToken", () => {
  it("creates intent, transitions to authorized, and returns DPoP token", async () => {
    const statusTransitions: IntentStatus[] = [];
    let issuedIntentId = "";
    let issuedWorkspace = "";
    let recordedIntentId = "";
    let recordedIssuedAtIso = "";
    let recordedExpiresAtIso = "";

    const result = await issueMcpBootstrapToken(
      {
        surreal: {} as Surreal,
        asSigningKey: {} as AsSigningKey,
        workspaceId: "workspace-1",
        identityId: "identity-1",
        dpopJwkThumbprint: "thumbprint-1",
        authorizationDetails: TEST_ACTIONS,
        goal: "Orchestrator MCP bootstrap",
        reasoning: "Issue token for spawned agent Brain MCP session bootstrap",
      },
      {
        checkIdentityAllowedFn: async () => ({ allowed: true }),
        createTraceFn: async () => new RecordId("trace", "trace-1"),
        createIntentFn: async () => new RecordId("intent", "intent-1"),
        updateIntentStatusFn: async (_surreal, _intentId, newStatus) => {
          statusTransitions.push(newStatus);
          return { ok: true, record: makeIntent(newStatus) };
        },
        issueAccessTokenFn: async (_signingKey, tokenInput) => {
          issuedIntentId = tokenInput.intentId;
          issuedWorkspace = tokenInput.workspace;
          return {
            ok: true,
            token: "dpop-token-1",
            expiresAt: new Date("2026-03-19T00:05:00.000Z"),
          };
        },
        recordTokenIssuanceFn: async (_surreal, intentId, tokenIssuedAt, tokenExpiresAt) => {
          recordedIntentId = intentId;
          recordedIssuedAtIso = tokenIssuedAt.toISOString();
          recordedExpiresAtIso = tokenExpiresAt.toISOString();
        },
        now: () => new Date("2026-03-19T00:00:00.000Z"),
      },
    );

    expect(statusTransitions).toEqual(["pending_auth", "authorized"]);
    expect(issuedIntentId).toBe("intent-1");
    expect(issuedWorkspace).toBe("workspace-1");
    expect(recordedIntentId).toBe("intent-1");
    expect(recordedIssuedAtIso).toBe("2026-03-19T00:00:00.000Z");
    expect(recordedExpiresAtIso).toBe("2026-03-19T00:05:00.000Z");
    expect(result).toEqual({
      accessToken: "dpop-token-1",
      expiresIn: 300,
    });
  });

  it("throws before intent creation when identity is not allowed", async () => {
    let traceCreated = false;

    await expect(
      issueMcpBootstrapToken(
        {
          surreal: {} as Surreal,
          asSigningKey: {} as AsSigningKey,
          workspaceId: "workspace-1",
          identityId: "identity-1",
          dpopJwkThumbprint: "thumbprint-1",
          authorizationDetails: TEST_ACTIONS,
          goal: "Orchestrator MCP bootstrap",
          reasoning: "Issue token for spawned agent Brain MCP session bootstrap",
        },
        {
          checkIdentityAllowedFn: async () => ({
            allowed: false,
            reason: "Identity has been revoked",
            code: "identity_revoked",
          }),
          createTraceFn: async () => {
            traceCreated = true;
            return new RecordId("trace", "trace-1");
          },
        },
      ),
    ).rejects.toThrow("Failed to issue MCP auth token: Identity has been revoked");

    expect(traceCreated).toBe(false);
  });

  it("throws when pending_auth transition fails", async () => {
    await expect(
      issueMcpBootstrapToken(
        {
          surreal: {} as Surreal,
          asSigningKey: {} as AsSigningKey,
          workspaceId: "workspace-1",
          identityId: "identity-1",
          dpopJwkThumbprint: "thumbprint-1",
          authorizationDetails: TEST_ACTIONS,
          goal: "Orchestrator MCP bootstrap",
          reasoning: "Issue token for spawned agent Brain MCP session bootstrap",
        },
        {
          checkIdentityAllowedFn: async () => ({ allowed: true }),
          createTraceFn: async () => new RecordId("trace", "trace-1"),
          createIntentFn: async () => new RecordId("intent", "intent-1"),
          updateIntentStatusFn: async () => ({
            ok: false,
            error: "Invalid transition from draft to authorized",
          }),
        },
      ),
    ).rejects.toThrow(
      "Failed to issue MCP auth token: Invalid transition from draft to authorized",
    );
  });
});
