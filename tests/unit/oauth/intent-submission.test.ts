import { describe, it, expect } from "bun:test";
import {
  validateIntentSubmission,
  type IntentSubmissionInput,
} from "../../../app/src/server/oauth/intent-submission";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validInput(): IntentSubmissionInput {
  return {
    workspace_id: "ws-001",
    identity_id: "id-001",
    authorization_details: [
      { type: "brain_action", action: "read", resource: "project:abc" },
    ],
    dpop_jwk_thumbprint: "thumb-abc123",
    goal: "Read project status",
    reasoning: "Need to check current task progress",
  };
}

// ---------------------------------------------------------------------------
// validateIntentSubmission — pure validation
// ---------------------------------------------------------------------------

describe("validateIntentSubmission", () => {
  it("accepts valid input with all required fields", () => {
    const result = validateIntentSubmission(validInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.workspace_id).toBe("ws-001");
      expect(result.data.authorization_details[0].type).toBe("brain_action");
      expect(result.data.dpop_jwk_thumbprint).toBe("thumb-abc123");
    }
  });

  it("accepts input with optional priority", () => {
    const input = { ...validInput(), priority: 5 };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.priority).toBe(5);
    }
  });

  // --- Missing required fields ---

  it("rejects missing authorization_details", () => {
    const { authorization_details, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("authorization_details");
    }
  });

  it("rejects empty authorization_details array", () => {
    const input = { ...validInput(), authorization_details: [] };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("authorization_details");
    }
  });

  it("rejects authorization_details with wrong type field", () => {
    const input = {
      ...validInput(),
      authorization_details: [
        { type: "wrong_type", action: "read", resource: "project:abc" },
      ],
    };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("brain_action");
    }
  });

  it("rejects authorization_details entry missing action", () => {
    const input = {
      ...validInput(),
      authorization_details: [
        { type: "brain_action", resource: "project:abc" },
      ],
    };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("action");
    }
  });

  it("rejects authorization_details entry missing resource", () => {
    const input = {
      ...validInput(),
      authorization_details: [
        { type: "brain_action", action: "read" },
      ],
    };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("resource");
    }
  });

  it("rejects missing dpop_jwk_thumbprint", () => {
    const { dpop_jwk_thumbprint, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("dpop_jwk_thumbprint");
    }
  });

  it("rejects empty dpop_jwk_thumbprint", () => {
    const input = { ...validInput(), dpop_jwk_thumbprint: "" };
    const result = validateIntentSubmission(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("dpop_jwk_thumbprint");
    }
  });

  it("rejects missing workspace_id", () => {
    const { workspace_id, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("workspace_id");
    }
  });

  it("rejects missing identity_id", () => {
    const { identity_id, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("identity_id");
    }
  });

  it("rejects missing goal", () => {
    const { goal, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("goal");
    }
  });

  it("rejects missing reasoning", () => {
    const { reasoning, ...rest } = validInput();
    const result = validateIntentSubmission(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("reasoning");
    }
  });

  it("rejects non-object input", () => {
    const result = validateIntentSubmission("not an object");
    expect(result.valid).toBe(false);
  });

  it("rejects null input", () => {
    const result = validateIntentSubmission(null);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveActionSpec — pure transformation
// ---------------------------------------------------------------------------

describe("deriveActionSpec", () => {
  // Lazy import to avoid errors before implementation exists
  const getDerive = async () => {
    const mod = await import("../../../app/src/server/oauth/intent-submission");
    return mod.deriveActionSpec;
  };

  it("derives action_spec from first brain_action for backward compat", async () => {
    const derive = await getDerive();
    const actions = [
      { type: "brain_action" as const, action: "read", resource: "project:abc" },
      { type: "brain_action" as const, action: "write", resource: "task:xyz" },
    ];
    const spec = derive(actions);
    expect(spec).toEqual({
      provider: "brain",
      action: "read",
      params: { resource: "project:abc" },
    });
  });
});

// ---------------------------------------------------------------------------
// isLowRiskReadAction — pure predicate
// ---------------------------------------------------------------------------

describe("isLowRiskReadAction", () => {
  const getIsLowRisk = async () => {
    const mod = await import("../../../app/src/server/oauth/intent-submission");
    return mod.isLowRiskReadAction;
  };

  it("returns true for read actions", async () => {
    const isLowRisk = await getIsLowRisk();
    const actions = [
      { type: "brain_action" as const, action: "read", resource: "project:abc" },
    ];
    expect(isLowRisk(actions)).toBe(true);
  });

  it("returns true for list actions", async () => {
    const isLowRisk = await getIsLowRisk();
    const actions = [
      { type: "brain_action" as const, action: "list", resource: "task:all" },
    ];
    expect(isLowRisk(actions)).toBe(true);
  });

  it("returns false for write actions", async () => {
    const isLowRisk = await getIsLowRisk();
    const actions = [
      { type: "brain_action" as const, action: "write", resource: "task:xyz" },
    ];
    expect(isLowRisk(actions)).toBe(false);
  });

  it("returns false for mixed read+write actions", async () => {
    const isLowRisk = await getIsLowRisk();
    const actions = [
      { type: "brain_action" as const, action: "read", resource: "project:abc" },
      { type: "brain_action" as const, action: "delete", resource: "task:xyz" },
    ];
    expect(isLowRisk(actions)).toBe(false);
  });
});
