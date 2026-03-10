import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";
import type { WorkspaceConversationResponse } from "../../../app/src/shared/contracts";
import {
  seedConversation,
  seedAssistantMessage,
  seedUserMessage,
  seedTraceForMessage,
  makeSampleTrace,
  makeSampleTraceMinimal,
} from "./trace-test-kit";

const getRuntime = setupAcceptanceSuite("trace_migration_batch");

describe("Batch Loading: Multiple messages with traces loaded in O(2) queries", () => {
  it("conversation with multiple traced messages returns all traces correctly", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-batch-1");
    const conv = await seedConversation(baseUrl, surreal, user, "batch");

    // GIVEN a conversation with 3 exchanges, 2 of which have traces
    const t0 = new Date();

    // Exchange 1: user asks, assistant responds with PM trace
    await seedUserMessage(surreal, conv.conversationRecord, "Plan the API layer", new Date(t0.getTime()));
    const msg1 = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "I'll create tasks for the API layer.",
      new Date(t0.getTime() + 1000),
    );
    await seedTraceForMessage(
      surreal,
      msg1,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace({ intent: "plan_work", totalDurationMs: 2000 }),
    );

    // Exchange 2: user asks, assistant responds WITHOUT trace
    await seedUserMessage(surreal, conv.conversationRecord, "What's our stack?", new Date(t0.getTime() + 2000));
    const msg2 = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "We use Bun, Hono, and SurrealDB.",
      new Date(t0.getTime() + 3000),
    );

    // Exchange 3: user asks status, assistant responds with PM trace
    await seedUserMessage(surreal, conv.conversationRecord, "Check project status", new Date(t0.getTime() + 4000));
    const msg3 = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Here is the current project status.",
      new Date(t0.getTime() + 5000),
    );
    await seedTraceForMessage(
      surreal,
      msg3,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTraceMinimal(),
    );

    // WHEN the conversation is loaded
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/conversations/${conv.conversationId}`,
      { headers: user.headers },
    );

    // THEN msg1 has a trace with intent "plan_work"
    const loaded1 = conversation.messages.find((m) => m.id === (msg1.id as string));
    expect(loaded1).toBeDefined();
    expect(loaded1!.subagentTraces).toBeDefined();
    expect(loaded1!.subagentTraces!.length).toBe(1);
    expect(loaded1!.subagentTraces![0]!.intent).toBe("plan_work");
    expect(loaded1!.subagentTraces![0]!.steps.length).toBe(3);

    // AND msg2 has no traces
    const loaded2 = conversation.messages.find((m) => m.id === (msg2.id as string));
    expect(loaded2).toBeDefined();
    expect(loaded2!.subagentTraces).toBeUndefined();

    // AND msg3 has a trace with intent "check_status"
    const loaded3 = conversation.messages.find((m) => m.id === (msg3.id as string));
    expect(loaded3).toBeDefined();
    expect(loaded3!.subagentTraces).toBeDefined();
    expect(loaded3!.subagentTraces!.length).toBe(1);
    expect(loaded3!.subagentTraces![0]!.intent).toBe("check_status");
    expect(loaded3!.subagentTraces![0]!.steps.length).toBe(1);
  }, 60_000);

  it("message with multiple spawns returns all trace trees", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-batch-2");
    const conv = await seedConversation(baseUrl, surreal, user, "multi-spawn");

    // GIVEN a message that triggered both PM and analytics agents
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Planned work and analyzed metrics.",
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace({ agentId: "pm_agent", intent: "plan_work" }),
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTraceMinimal(),
    );

    // WHEN loaded via API
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/conversations/${conv.conversationId}`,
      { headers: user.headers },
    );

    // THEN both traces are present
    const loaded = conversation.messages.find((m) => m.id === (assistantMsg.id as string));
    expect(loaded).toBeDefined();
    expect(loaded!.subagentTraces).toBeDefined();
    expect(loaded!.subagentTraces!.length).toBe(2);

    const intents = loaded!.subagentTraces!.map((t) => t.intent).sort();
    expect(intents).toEqual(["check_status", "plan_work"]);
  }, 60_000);
});
