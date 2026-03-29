/**
 * Bridge Session-to-Token Exchange
 *
 * Unit tests for POST /api/auth/bridge/exchange.
 * Pure validation functions + handler behavior through driving port.
 *
 * Step: 04-01
 */
import { describe, expect, it } from "bun:test";
import {
  validateBridgeExchangeRequest,
  type BridgeExchangeInput,
} from "../../../app/src/server/oauth/bridge";

// ---------------------------------------------------------------------------
// Pure Validation: validateBridgeExchangeRequest
// ---------------------------------------------------------------------------

describe("validateBridgeExchangeRequest", () => {
  const validInput = {
    authorization_details: [
      { type: "osabio_action", action: "read", resource: "workspace" },
    ],
  };

  it("accepts valid request with authorization_details", () => {
    const result = validateBridgeExchangeRequest(validInput);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.authorizationDetails).toHaveLength(1);
      expect(result.data.authorizationDetails[0].type).toBe("osabio_action");
      expect(result.data.authorizationDetails[0].action).toBe("read");
      expect(result.data.authorizationDetails[0].resource).toBe("workspace");
    }
  });

  it("rejects null body", () => {
    const result = validateBridgeExchangeRequest(null);
    expect(result.valid).toBe(false);
  });

  it("rejects missing authorization_details", () => {
    const result = validateBridgeExchangeRequest({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("authorization_details");
    }
  });

  it("rejects empty authorization_details array", () => {
    const result = validateBridgeExchangeRequest({
      authorization_details: [],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects authorization_details entry without type osabio_action", () => {
    const result = validateBridgeExchangeRequest({
      authorization_details: [
        { type: "other", action: "read", resource: "workspace" },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("osabio_action");
    }
  });

  it("rejects authorization_details entry without action", () => {
    const result = validateBridgeExchangeRequest({
      authorization_details: [
        { type: "osabio_action", resource: "workspace" },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects authorization_details entry without resource", () => {
    const result = validateBridgeExchangeRequest({
      authorization_details: [
        { type: "osabio_action", action: "read" },
      ],
    });
    expect(result.valid).toBe(false);
  });
});
