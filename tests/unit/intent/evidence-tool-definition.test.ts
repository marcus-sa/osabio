/**
 * Unit tests for evidence_refs in create_intent tool definition.
 *
 * Validates:
 * - createIntentSchema accepts evidence_refs as optional array of strings
 * - evidence_refs field has proper describe guidance
 * - CREATE_INTENT_TOOL description explains evidence submission
 * - Schema validates evidence_refs format correctly
 */
import { describe, expect, it } from "bun:test";
import {
  createIntentSchema,
  CREATE_INTENT_TOOL,
} from "../../../app/src/server/mcp/osabio-tool-definitions";

describe("createIntentSchema evidence_refs field", () => {
  it("accepts intent with evidence_refs as optional array of strings", () => {
    const validInput = {
      goal: "Reroute Southeast Asia orders through regional hub",
      reasoning: "Decision confirmed, audit complete, lead time data supports",
      action_spec: {
        provider: "osabio",
        action: "update_routing",
        params: { region: "sea" },
      },
      evidence_refs: [
        "decision:abc123",
        "task:def456",
        "observation:ghi789",
      ],
    };

    const result = createIntentSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence_refs).toEqual([
        "decision:abc123",
        "task:def456",
        "observation:ghi789",
      ]);
    }
  });

  it("accepts intent without evidence_refs (optional field)", () => {
    const validInput = {
      goal: "Read fulfillment metrics",
      reasoning: "Low-risk data read operation",
      action_spec: {
        provider: "osabio",
        action: "read_metrics",
        params: {},
      },
    };

    const result = createIntentSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence_refs).toBeUndefined();
    }
  });

  it("rejects evidence_refs with non-string elements", () => {
    const invalidInput = {
      goal: "Some goal",
      reasoning: "Some reasoning",
      action_spec: {
        provider: "osabio",
        action: "test",
        params: {},
      },
      evidence_refs: [123, "decision:abc"],
    };

    const result = createIntentSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });
});

describe("CREATE_INTENT_TOOL description", () => {
  it("mentions evidence in the tool description", () => {
    const description = CREATE_INTENT_TOOL.description.toLowerCase();
    expect(description).toContain("evidence");
  });

  it("mentions entity types valid for evidence", () => {
    const description = CREATE_INTENT_TOOL.description.toLowerCase();
    expect(description).toContain("decision");
    expect(description).toContain("task");
  });

  it("mentions enforcement impact", () => {
    const description = CREATE_INTENT_TOOL.description.toLowerCase();
    expect(description).toContain("enforcement");
  });
});

describe("CREATE_INTENT_TOOL inputSchema includes evidence_refs", () => {
  it("has evidence_refs in the JSON schema properties", () => {
    const inputSchema = CREATE_INTENT_TOOL.inputSchema as {
      properties?: Record<string, unknown>;
    };
    expect(inputSchema.properties).toBeDefined();
    expect(inputSchema.properties!.evidence_refs).toBeDefined();
  });
});
