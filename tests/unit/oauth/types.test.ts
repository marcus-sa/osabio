/**
 * Unit tests for OAuth RAR+DPoP algebraic data types.
 *
 * Tests type construction and validation helpers for domain types.
 */
import { describe, expect, it } from "bun:test";
import {
  type BrainAction,
  type DPoPErrorCode,
  type DPoPValidationResult,
  type TokenIssuanceResult,
  type RARVerificationResult,
  createBrainAction,
} from "../../../app/src/server/oauth/types";

describe("BrainAction construction", () => {
  it("creates a valid brain action with required fields", () => {
    const action = createBrainAction("read", "workspace");

    expect(action.type).toBe("brain_action");
    expect(action.action).toBe("read");
    expect(action.resource).toBe("workspace");
    expect(action.constraints).toBeUndefined();
  });

  it("creates a brain action with constraints", () => {
    const action = createBrainAction("update", "task", {
      task_id: "task-123",
    });

    expect(action.type).toBe("brain_action");
    expect(action.action).toBe("update");
    expect(action.resource).toBe("task");
    expect(action.constraints).toEqual({ task_id: "task-123" });
  });
});

describe("DPoPValidationResult discriminated union", () => {
  it("valid result carries thumbprint and claims", () => {
    const result: DPoPValidationResult = {
      valid: true,
      thumbprint: "abc123",
      claims: {
        jti: "unique-id",
        htm: "POST",
        htu: "https://example.com/api",
        iat: 1700000000,
      },
    };

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.thumbprint).toBe("abc123");
      expect(result.claims.htm).toBe("POST");
    }
  });

  it("invalid result carries error and code", () => {
    const result: DPoPValidationResult = {
      valid: false,
      error: "Missing DPoP proof",
      code: "dpop_required",
    };

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Missing DPoP proof");
      expect(result.code).toBe("dpop_required");
    }
  });
});

describe("TokenIssuanceResult discriminated union", () => {
  it("ok result carries token and expiry", () => {
    const result: TokenIssuanceResult = {
      ok: true,
      token: "jwt-token-here",
      expiresAt: new Date("2026-01-01"),
    };

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBe("jwt-token-here");
    }
  });

  it("error result carries error and code", () => {
    const result: TokenIssuanceResult = {
      ok: false,
      error: "Intent not authorized",
      code: "intent_not_authorized",
    };

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("intent_not_authorized");
    }
  });
});

describe("RARVerificationResult discriminated union", () => {
  it("authorized result", () => {
    const result: RARVerificationResult = { authorized: true };
    expect(result.authorized).toBe(true);
  });

  it("unauthorized result carries error and code", () => {
    const result: RARVerificationResult = {
      authorized: false,
      error: "Missing authorization_details",
      code: "authorization_details_missing",
    };

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_details_missing");
    }
  });
});

