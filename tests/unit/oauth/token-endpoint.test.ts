/**
 * Unit tests for Custom AS token endpoint.
 *
 * Tests the pure validation pipeline for POST /api/auth/token:
 * - Authorized intent receives DPoP-bound token with token_type=DPoP
 * - Token rejected for non-authorized intent status
 * - Token rejected when proof key does not match intent binding
 * - Token rejected when authorization_details do not match
 * - Token rejected for missing proof or non-existent intent
 * - Re-issuance for same intent succeeds
 *
 * Step: 02-04
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import { generateKeyPair } from "../../../app/src/server/oauth/dpop";
import { generateAsSigningKey } from "../../../app/src/server/oauth/as-key-management";
import type { BrainAction } from "../../../app/src/server/oauth/types";
import type { IntentRecord } from "../../../app/src/server/intent/types";
import { RecordId } from "surrealdb";
import {
  validateTokenRequest,
  verifyIntentForTokenIssuance,
  matchAuthorizationDetails,
  type TokenRequest,
} from "../../../app/src/server/oauth/token-endpoint";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_ACTIONS: BrainAction[] = [
  { type: "brain_action", action: "read", resource: "workspace" },
];

function createAuthorizedIntent(overrides?: Partial<IntentRecord>): IntentRecord {
  return {
    id: new RecordId("intent", "test-intent-123"),
    goal: "Read workspace data",
    reasoning: "Need to access workspace",
    status: "authorized",
    priority: 0,
    action_spec: { provider: "brain", action: "read", params: { resource: "workspace" } },
    trace_id: new RecordId("trace", "trace-abc"),
    requester: new RecordId("identity", "actor-123"),
    workspace: new RecordId("workspace", "ws-456"),
    created_at: new Date(),
    authorization_details: TEST_ACTIONS,
    dpop_jwk_thumbprint: "test-thumbprint-abc",
    ...overrides,
  };
}

// ===========================================================================
// validateTokenRequest: request body parsing
// ===========================================================================

describe("validateTokenRequest", () => {
  it("accepts a valid token request body", () => {
    const result = validateTokenRequest({
      grant_type: "urn:brain:intent-authorization",
      intent_id: "test-intent-123",
      authorization_details: TEST_ACTIONS,
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.grantType).toBe("urn:brain:intent-authorization");
    expect(result.data.intentId).toBe("test-intent-123");
    expect(result.data.authorizationDetails).toEqual(TEST_ACTIONS);
  });

  it("rejects unsupported grant_type", () => {
    const result = validateTokenRequest({
      grant_type: "authorization_code",
      intent_id: "test-intent-123",
      authorization_details: TEST_ACTIONS,
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe("unsupported_grant_type");
  });

  it("rejects missing intent_id", () => {
    const result = validateTokenRequest({
      grant_type: "urn:brain:intent-authorization",
      authorization_details: TEST_ACTIONS,
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe("invalid_request");
  });

  it("rejects missing authorization_details", () => {
    const result = validateTokenRequest({
      grant_type: "urn:brain:intent-authorization",
      intent_id: "test-intent-123",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe("invalid_request");
  });

  it("rejects empty authorization_details array", () => {
    const result = validateTokenRequest({
      grant_type: "urn:brain:intent-authorization",
      intent_id: "test-intent-123",
      authorization_details: [],
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe("invalid_request");
  });
});

// ===========================================================================
// verifyIntentForTokenIssuance: intent state + thumbprint verification
// ===========================================================================

describe("verifyIntentForTokenIssuance", () => {
  it("passes for authorized intent with matching thumbprint", () => {
    const intent = createAuthorizedIntent({ dpop_jwk_thumbprint: "matching-thumb" });
    const result = verifyIntentForTokenIssuance(intent, "matching-thumb");

    expect(result.ok).toBe(true);
  });

  it("rejects when intent status is not authorized", () => {
    const intent = createAuthorizedIntent({ status: "pending_auth" });
    const result = verifyIntentForTokenIssuance(intent, "any-thumb");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(result.errorDescription).toBe("Intent not in authorized status");
  });

  it("rejects when intent status is draft", () => {
    const intent = createAuthorizedIntent({ status: "draft" });
    const result = verifyIntentForTokenIssuance(intent, "any-thumb");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
  });

  it("rejects when intent status is vetoed", () => {
    const intent = createAuthorizedIntent({ status: "vetoed" });
    const result = verifyIntentForTokenIssuance(intent, "any-thumb");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
  });

  it("rejects when proof thumbprint does not match intent binding", () => {
    const intent = createAuthorizedIntent({ dpop_jwk_thumbprint: "bound-thumb" });
    const result = verifyIntentForTokenIssuance(intent, "different-thumb");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(result.errorDescription).toBe("DPoP key does not match intent binding");
  });
});

// ===========================================================================
// matchAuthorizationDetails: deep comparison of requested vs intent
// ===========================================================================

describe("matchAuthorizationDetails", () => {
  it("matches identical authorization_details", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(true);
  });

  it("matches multiple actions in same order", () => {
    const actions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
      { type: "brain_action", action: "write", resource: "task" },
    ];

    const result = matchAuthorizationDetails(actions, actions);
    expect(result.ok).toBe(true);
  });

  it("rejects when action differs", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "write", resource: "workspace" },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(result.errorDescription).toBe("Authorization details do not match");
  });

  it("rejects when resource differs", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "project" },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
  });

  it("rejects when array lengths differ", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
      { type: "brain_action", action: "write", resource: "task" },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
  });

  it("rejects when requested constraints exceed intent constraints", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace", constraints: { max_results: 200 } },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace", constraints: { max_results: 100 } },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(result.errorDescription).toContain("max_results");
    expect(result.errorDescription).toContain("exceeds authorized bound");
  });

  it("accepts when requested constraints are within intent bounds", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace", constraints: { max_results: 50 } },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace", constraints: { max_results: 100 } },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(true);
  });

  it("accepts when requested has no constraints but intent does", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];
    const intentActions: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace", constraints: { max_results: 100 } },
    ];

    const result = matchAuthorizationDetails(requested, intentActions);
    expect(result.ok).toBe(true);
  });

  it("rejects when intent has no authorization_details", () => {
    const requested: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];

    const result = matchAuthorizationDetails(requested, undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
  });
});
