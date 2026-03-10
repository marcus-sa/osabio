import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";
import type { WorkspaceBootstrapResponse, WorkspaceConversationResponse } from "../../../app/src/shared/contracts";
import {
  seedConversation,
  seedAssistantMessage,
  seedUserMessage,
  seedTraceForMessage,
  makeSampleTrace,
  querySpawnedTraces,
  queryChildTraces,
} from "./trace-test-kit";

const getRuntime = setupAcceptanceSuite("trace_migration_skeleton");

describe("Walking Skeleton: Trace records with spawns edges produce identical wire format", () => {
  it("traces seeded via spawns edges are returned as subagentTraces on conversation load", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-skel-1");
    const conv = await seedConversation(baseUrl, surreal, user, "skeleton");

    // GIVEN a user message and an assistant message in the conversation
    const t0 = new Date();
    await seedUserMessage(surreal, conv.conversationRecord, "Plan the dashboard feature", t0);
    const t1 = new Date(t0.getTime() + 1000);
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "I've planned the dashboard. Here are the tasks I created.",
      t1,
    );

    // AND trace records with a spawns edge from the assistant message
    const sampleTrace = makeSampleTrace();
    const fixture = await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      sampleTrace,
    );

    // WHEN the conversation is loaded via the API
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/conversations/${conv.conversationId}`,
      { headers: user.headers },
    );

    // THEN the assistant message includes subagentTraces in the correct wire format
    const loaded = conversation.messages.find((m) => m.id === (assistantMsg.id as string));
    expect(loaded).toBeDefined();
    expect(loaded!.subagentTraces).toBeDefined();
    expect(loaded!.subagentTraces!.length).toBe(1);

    const loadedTrace = loaded!.subagentTraces![0]!;
    expect(loadedTrace.agentId).toBe("pm_agent");
    expect(loadedTrace.intent).toBe("plan_work");
    expect(loadedTrace.totalDurationMs).toBe(1500);
    expect(loadedTrace.steps.length).toBe(3);

    // Verify step types and shapes
    const toolSteps = loadedTrace.steps.filter((s) => s.type === "tool_call");
    const textSteps = loadedTrace.steps.filter((s) => s.type === "text");
    expect(toolSteps.length).toBe(2);
    expect(textSteps.length).toBe(1);

    expect(toolSteps[0]!.toolName).toBe("search_entities");
    expect(toolSteps[1]!.toolName).toBe("create_work_item");
    expect(textSteps[0]!.text).toBe("I've created a task for the dashboard feature.");
  }, 60_000);

  it("traces are returned via workspace bootstrap endpoint", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-skel-2");
    const conv = await seedConversation(baseUrl, surreal, user, "bootstrap");

    // GIVEN an assistant message with a seeded trace
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Here is your project plan.",
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace({ intent: "plan_work", agentId: "pm_agent" }),
    );

    // WHEN workspace bootstrap is called
    const bootstrap = await fetchJson<WorkspaceBootstrapResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/bootstrap`,
      { headers: user.headers },
    );

    // THEN the bootstrap messages include subagentTraces
    const loaded = bootstrap.messages.find((m) => m.id === (assistantMsg.id as string));
    expect(loaded).toBeDefined();
    expect(loaded!.subagentTraces).toBeDefined();
    expect(loaded!.subagentTraces!.length).toBe(1);
    expect(loaded!.subagentTraces![0]!.agentId).toBe("pm_agent");
  }, 60_000);

  it("messages without traces have no subagentTraces field", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-skel-3");
    const conv = await seedConversation(baseUrl, surreal, user, "no-traces");

    // GIVEN an assistant message with NO traces
    await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "A simple response with no subagent invocation.",
    );

    // WHEN the conversation is loaded
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/conversations/${conv.conversationId}`,
      { headers: user.headers },
    );

    // THEN messages without traces omit the subagentTraces field
    const plainMessages = conversation.messages.filter((m) => !m.subagentTraces);
    expect(plainMessages.length).toBeGreaterThan(0);
  }, 60_000);
});
