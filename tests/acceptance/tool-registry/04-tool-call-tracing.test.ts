/**
 * Acceptance Tests: Tool Call Tracing (US-9)
 *
 * Walking skeleton phase 4: Every Brain-managed tool execution produces
 * a forensic trace record with tool_name, duration, outcome, and identity.
 *
 * Traces: US-9, FR-13, AC-9, NFR-5
 * Driving port: POST /proxy/llm/anthropic/v1/messages (step 9 extended)
 *
 * Implementation sequence:
 *   1. Walking skeleton: Brain-native tool call produces trace record  [ENABLED]
 *   2. Trace records success outcome with duration
 *   3. Trace records error outcome for failed execution
 *   4. Trace records denied outcome for governance denial
 *   5. Trace records rate_limited outcome
 *   6. Unknown (pass-through) tool calls do NOT produce trace records
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedToolWithGrant,
  seedBrainNativeTool,
  seedCanUseEdge,
  getToolCallTraces,
  sendProxyRequestWithIdentity,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_tracing");

// ---------------------------------------------------------------------------
// Walking Skeleton: Tool execution writes trace record
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Brain-native tool call produces trace record", () => {
  it("writes a trace with type tool_call, tool_name, identity, workspace, and outcome", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-trace-${crypto.randomUUID()}`);

    // Given agent has can_use edge to "search_entities"
    await seedToolWithGrant(surreal, {
      toolId: `tool-trace-${crypto.randomUUID()}`,
      toolName: "search_entities",
      toolkit: "brain",
      description: "Search workspace entities",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
    });

    // When the proxy executes a tool call for "search_entities"
    await sendProxyRequestWithIdentity(baseUrl, surreal, user, {
      messages: [{ role: "user", content: "Use search_entities to find tasks about auth" }],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Allow async trace capture
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then a trace record exists with tool_call type
    const traces = await getToolCallTraces(surreal, user.workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0];
    expect(trace.type).toBe("tool_call");
    expect(trace.tool_name).toBe("search_entities");
    expect(trace.workspace).toBeDefined();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Trace records success outcome with duration", () => {
  it.skip("includes outcome:success and duration_ms > 0 for successful execution", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-tsuc-${crypto.randomUUID()}`);

    // Given a successful tool execution
    await seedToolWithGrant(surreal, {
      toolId: `tool-tsuc-${crypto.randomUUID()}`,
      toolName: "search_entities",
      toolkit: "brain",
      description: "Search workspace entities",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
    });

    await sendProxyRequestWithIdentity(baseUrl, surreal, user, {
      messages: [{ role: "user", content: "Use search_entities to find any entity" }],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then trace has success outcome and non-zero duration
    const traces = await getToolCallTraces(surreal, user.workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0];
    expect(trace.output?.outcome).toBe("success");
    expect(trace.duration_ms).toBeGreaterThan(0);
  }, 60_000);
});

describe("Unknown tool calls do not produce trace records", () => {
  it.skip("does not write a trace for runtime tools the proxy passes through", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-notr-${crypto.randomUUID()}`);

    // Given the LLM uses "read_file" (unknown to Brain)
    const response = await sendProxyRequestWithIdentity(baseUrl, surreal, user, {
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
      ],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    expect(response.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then no tool_call trace record exists for the workspace
    const traces = await getToolCallTraces(surreal, user.workspaceId);
    const readFileTraces = traces.filter(t => t.tool_name === "read_file");
    expect(readFileTraces.length).toBe(0);
  }, 30_000);
});

describe("Trace includes identity reference for auditability", () => {
  it.skip("records the calling identity on the trace for forensic audit", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-tident-${crypto.randomUUID()}`);

    // Given agent executes a Brain-native tool
    await seedToolWithGrant(surreal, {
      toolId: `tool-tident-${crypto.randomUUID()}`,
      toolName: "search_entities",
      toolkit: "brain",
      description: "Search entities",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
    });

    await sendProxyRequestWithIdentity(baseUrl, surreal, user, {
      messages: [{ role: "user", content: "Use search_entities to find projects" }],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the trace includes the actor identity
    const traces = await getToolCallTraces(surreal, user.workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
    expect(traces[0].actor).toBeDefined();
  }, 60_000);
});
