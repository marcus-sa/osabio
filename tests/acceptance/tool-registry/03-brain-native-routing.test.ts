/**
 * Acceptance Tests: Brain-Native Tool Call Routing (US-6a)
 *
 * Walking skeleton phase 3: The proxy intercepts tool_use blocks for
 * Brain-native tools and executes them directly via graph queries.
 *
 * Traces: US-6a, FR-5, AC-6
 * Driving port: POST /proxy/llm/anthropic/v1/messages (step 8.5)
 *
 * Implementation sequence:
 *   1. Walking skeleton: Brain-native tool call executed via graph query  [ENABLED]
 *   2. Unknown tool call passed through to runtime
 *   3. Brain-native tool returns results to LLM conversation
 *   4. Error in Brain-native execution returns tool_result error
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedToolWithGrant,
  sendProxyRequestWithIdentity,
  createMockAnthropicServer,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_brain_native");

const mockAnthropic = createMockAnthropicServer();
beforeAll(() => mockAnthropic.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => mockAnthropic.close());

// ---------------------------------------------------------------------------
// Walking Skeleton: Proxy executes Brain-native tool call directly
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Proxy intercepts and executes Brain-native tool call", () => {
  it("executes search_entities via graph query when LLM requests the tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-native-${crypto.randomUUID()}`);

    // Given agent has can_use edge to Brain-native tool "search_entities"
    await seedToolWithGrant(surreal, {
      toolId: `tool-se-${crypto.randomUUID()}`,
      toolName: "search_entities",
      toolkit: "brain",
      description: "Search workspace entities by text query",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
    });

    // When the proxy injects the tool and the LLM returns a tool_call for "search_entities"
    // (We send a prompt that encourages tool use)
    const response = await sendProxyRequestWithIdentity(baseUrl, user, {
      messages: [{ role: "user", content: "Use the search_entities tool to find tasks about authentication" }],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Then the proxy executes the graph query directly (no credential resolution)
    // And returns results to the LLM
    expect(response.status).toBe(200);
    const body = await response.json() as { content: Array<{ type: string; text?: string }> };
    expect(body.content).toBeDefined();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Unknown tool call passed through to runtime", () => {
  it.skip("does not intercept tool calls for tools not in the Brain registry", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-unknown-${crypto.randomUUID()}`);

    // Given the LLM returns tool_call for "read_file" (a runtime tool)
    // And "read_file" does not match any mcp_tool record
    const response = await sendProxyRequestWithIdentity(baseUrl, user, {
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { name: "read_file", description: "Read a file from disk", input_schema: { type: "object", properties: { path: { type: "string" } } } },
      ],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Then the proxy passes the tool call through to the runtime
    // And does not attempt credential resolution
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Brain-native tool execution error returns tool_result error", () => {
  it.skip("returns is_error tool_result when graph query fails", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-err-${crypto.randomUUID()}`);

    // Given agent has a Brain-native tool that will produce an error
    // (e.g., tool with malformed input schema or invalid handler)
    await seedToolWithGrant(surreal, {
      toolId: `tool-bad-${crypto.randomUUID()}`,
      toolName: "nonexistent_brain_tool",
      toolkit: "brain",
      description: "A tool with no handler",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
    });

    // When the proxy tries to execute it
    const response = await sendProxyRequestWithIdentity(baseUrl, user, {
      messages: [{ role: "user", content: "Use the nonexistent_brain_tool" }],
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Then the LLM receives an error tool_result (not a 500)
    // The proxy should return the error as tool_result content, not crash
    expect(response.status).toBe(200);
  }, 30_000);
});
