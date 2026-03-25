/**
 * Scope Engine & Error Response Builder — Pure Functions
 *
 * Tests for computeEffectiveScope, classifyTools (scope-engine.ts)
 * and buildIntentRequiredError, buildConstraintViolationError,
 * enrichGatedDescription (error-response-builder.ts).
 *
 * Step: 01-01
 */
import { describe, expect, it } from "bun:test";
import {
  computeEffectiveScope,
  classifyTools,
  type AuthorizedIntentSummary,
  type EffectiveScope,
} from "../../../app/src/server/mcp/scope-engine";
import {
  buildIntentRequiredError,
  buildConstraintViolationError,
  enrichGatedDescription,
} from "../../../app/src/server/mcp/error-response-builder";
import type { BrainAction } from "../../../app/src/server/oauth/types";
import type { ResolvedTool } from "../../../app/src/server/proxy/tool-injector";

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeAction(
  action: string,
  resource: string,
  constraints?: Record<string, unknown>,
): BrainAction {
  return { type: "brain_action", action, resource, ...( constraints ? { constraints } : {}) };
}

function makeIntent(
  intentId: string,
  actions: BrainAction[],
): AuthorizedIntentSummary {
  return { intentId, authorizationDetails: actions };
}

function makeTool(name: string, toolkit: string): ResolvedTool {
  return {
    name,
    description: `Tool ${name}`,
    input_schema: {},
    toolkit,
    risk_level: "low",
  };
}

// ---------------------------------------------------------------------------
// computeEffectiveScope
// ---------------------------------------------------------------------------

describe("computeEffectiveScope", () => {
  it("returns empty scope for zero intents", () => {
    const scope = computeEffectiveScope([]);
    expect(scope.authorizedActions).toEqual([]);
    expect(scope.intents).toEqual([]);
  });

  it("returns actions from a single intent", () => {
    const action = makeAction("execute", "mcp_tool:github:list_repos");
    const intent = makeIntent("intent-1", [action]);

    const scope = computeEffectiveScope([intent]);

    expect(scope.authorizedActions).toHaveLength(1);
    expect(scope.authorizedActions[0]).toEqual(action);
    expect(scope.intents).toHaveLength(1);
    expect(scope.intents[0].intentId).toBe("intent-1");
  });

  it("unions actions from multiple intents into flat array", () => {
    const action1 = makeAction("execute", "mcp_tool:github:list_repos");
    const action2 = makeAction("execute", "mcp_tool:slack:send_message");
    const action3 = makeAction("read", "mcp_tool:github:get_file");
    const intent1 = makeIntent("intent-1", [action1, action3]);
    const intent2 = makeIntent("intent-2", [action2]);

    const scope = computeEffectiveScope([intent1, intent2]);

    expect(scope.authorizedActions).toHaveLength(3);
    expect(scope.authorizedActions).toContainEqual(action1);
    expect(scope.authorizedActions).toContainEqual(action2);
    expect(scope.authorizedActions).toContainEqual(action3);
    expect(scope.intents).toHaveLength(2);
  });

  it("preserves constraints on actions", () => {
    const action = makeAction("execute", "mcp_tool:github:create_pr", {
      max_files: 10,
    });
    const intent = makeIntent("intent-1", [action]);

    const scope = computeEffectiveScope([intent]);

    expect(scope.authorizedActions[0].constraints).toEqual({ max_files: 10 });
  });
});

// ---------------------------------------------------------------------------
// classifyTools
// ---------------------------------------------------------------------------

describe("classifyTools", () => {
  const brainNativeToolNames = new Set(["get_context", "create_decision"]);

  it("classifies brain-native tools", () => {
    const tool = makeTool("get_context", "brain");
    const scope: EffectiveScope = { authorizedActions: [], intents: [] };

    const results = classifyTools([tool], scope, brainNativeToolNames);

    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe(tool);
    expect(results[0].classification.kind).toBe("brain_native");
  });

  it("classifies authorized tools with matching intent", () => {
    const tool = makeTool("list_repos", "github");
    const action = makeAction("execute", "mcp_tool:github:list_repos");
    const intent = makeIntent("intent-1", [action]);
    const scope = computeEffectiveScope([intent]);

    const results = classifyTools([tool], scope, brainNativeToolNames);

    expect(results).toHaveLength(1);
    expect(results[0].classification.kind).toBe("authorized");
    if (results[0].classification.kind === "authorized") {
      expect(results[0].classification.matchingIntent.intentId).toBe("intent-1");
    }
  });

  it("classifies gated tools with no matching intent", () => {
    const tool = makeTool("send_message", "slack");
    const scope: EffectiveScope = { authorizedActions: [], intents: [] };

    const results = classifyTools([tool], scope, brainNativeToolNames);

    expect(results).toHaveLength(1);
    expect(results[0].classification.kind).toBe("gated");
  });

  it("classifies a mixed set of tools correctly", () => {
    const nativeTool = makeTool("get_context", "brain");
    const authorizedTool = makeTool("list_repos", "github");
    const gatedTool = makeTool("send_message", "slack");

    const action = makeAction("execute", "mcp_tool:github:list_repos");
    const intent = makeIntent("intent-1", [action]);
    const scope = computeEffectiveScope([intent]);

    const results = classifyTools(
      [nativeTool, authorizedTool, gatedTool],
      scope,
      brainNativeToolNames,
    );

    expect(results).toHaveLength(3);

    const nativeResult = results.find((r) => r.tool.name === "get_context");
    const authResult = results.find((r) => r.tool.name === "list_repos");
    const gatedResult = results.find((r) => r.tool.name === "send_message");

    expect(nativeResult?.classification.kind).toBe("brain_native");
    expect(authResult?.classification.kind).toBe("authorized");
    expect(gatedResult?.classification.kind).toBe("gated");
  });

  it("brain_native takes priority over authorized match", () => {
    // Edge case: tool name is in brainNativeToolNames AND has a matching action
    const tool = makeTool("get_context", "brain");
    const action = makeAction("execute", "mcp_tool:brain:get_context");
    const intent = makeIntent("intent-1", [action]);
    const scope = computeEffectiveScope([intent]);

    const results = classifyTools([tool], scope, brainNativeToolNames);

    expect(results[0].classification.kind).toBe("brain_native");
  });
});

// ---------------------------------------------------------------------------
// buildIntentRequiredError
// ---------------------------------------------------------------------------

describe("buildIntentRequiredError", () => {
  it("returns correct error shape", () => {
    const error = buildIntentRequiredError("list_repos", "github");

    expect(error.code).toBe(-32403);
    expect(error.message).toBe("intent_required");
    expect(error.data.tool).toBe("list_repos");
    expect(error.data.action_spec_template.provider).toBe("github");
    expect(error.data.action_spec_template.action).toBe("list_repos");
  });

  it("includes parameterSchema when provided", () => {
    const schema = { type: "object", properties: { repo: { type: "string" } } };
    const error = buildIntentRequiredError("list_repos", "github", schema);

    expect(error.data.action_spec_template.parameterSchema).toEqual(schema);
  });

  it("omits parameterSchema when not provided", () => {
    const error = buildIntentRequiredError("list_repos", "github");

    expect(error.data.action_spec_template.parameterSchema).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildConstraintViolationError
// ---------------------------------------------------------------------------

describe("buildConstraintViolationError", () => {
  it("returns correct error shape", () => {
    const error = buildConstraintViolationError("max_files", 20, 10);

    expect(error.code).toBe(-32403);
    expect(error.message).toBe("constraint_violation");
    expect(error.data.field).toBe("max_files");
    expect(error.data.requested).toBe(20);
    expect(error.data.authorized).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// enrichGatedDescription
// ---------------------------------------------------------------------------

describe("enrichGatedDescription", () => {
  it("prepends escalation instructions to original description", () => {
    const result = enrichGatedDescription(
      "Lists repositories for the authenticated user",
      "github",
      "execute",
    );

    expect(result).toContain("Lists repositories for the authenticated user");
    expect(result).toContain("github");
    expect(result.indexOf("github")).toBeLessThan(
      result.indexOf("Lists repositories for the authenticated user"),
    );
  });

  it("includes intent requirement in escalation text", () => {
    const result = enrichGatedDescription("Original desc", "slack", "execute");

    expect(result.toLowerCase()).toContain("intent");
    expect(result).toContain("slack");
  });
});
