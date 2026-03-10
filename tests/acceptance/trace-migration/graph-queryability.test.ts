import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  seedConversation,
  seedAssistantMessage,
  seedTraceForMessage,
  makeSampleTrace,
  makeSampleTraceMinimal,
  querySpawnedTraces,
  queryChildTraces,
} from "./trace-test-kit";

const getRuntime = setupAcceptanceSuite("trace_migration_graph");

describe("Graph Queryability: Traces are discoverable via SurrealDB graph traversal", () => {
  it("forward traversal: message ->spawns-> trace returns root traces", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-graph-1");
    const conv = await seedConversation(baseUrl, surreal, user, "graph-fwd");

    // GIVEN an assistant message with a seeded trace
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Planned the feature.",
    );
    const fixture = await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace(),
    );

    // WHEN forward graph traversal is performed
    const rootTraces = await querySpawnedTraces(surreal, assistantMsg);

    // THEN the root trace is returned with type "subagent_spawn"
    expect(rootTraces.length).toBe(1);
    expect(rootTraces[0]!.type).toBe("subagent_spawn");
    expect((rootTraces[0]!.id.id as string)).toBe(fixture.rootTraceId);
  }, 30_000);

  it("child traces are linked via parent_trace to root", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-graph-2");
    const conv = await seedConversation(baseUrl, surreal, user, "graph-child");

    // GIVEN a trace with 3 steps (2 tool_call + 1 text)
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Created tasks.",
    );
    const sampleTrace = makeSampleTrace();
    const fixture = await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      sampleTrace,
    );

    // WHEN querying children of the root trace
    const rootTraceRecord = new RecordId("trace", fixture.rootTraceId);
    const children = await queryChildTraces(surreal, rootTraceRecord);

    // THEN 3 child traces are returned matching the step types
    expect(children.length).toBe(3);
    expect(children[0]!.type).toBe("tool_call");
    expect(children[0]!.tool_name).toBe("search_entities");
    expect(children[1]!.type).toBe("tool_call");
    expect(children[1]!.tool_name).toBe("create_work_item");
    expect(children[2]!.type).toBe("message"); // "text" mapped to "message" in trace table
  }, 30_000);

  it("reverse traversal: trace ->spawns<- message returns source message", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-graph-3");
    const conv = await seedConversation(baseUrl, surreal, user, "graph-rev");

    // GIVEN a message with a trace
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Agent output.",
    );
    const fixture = await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTraceMinimal(),
    );

    // WHEN reverse graph traversal is performed from the trace
    const rootTraceRecord = new RecordId("trace", fixture.rootTraceId);
    const [rows] = await surreal
      .query<[Array<{ source: RecordId[] }>]>(
        "SELECT <-spawns<-message AS source FROM $trace;",
        { trace: rootTraceRecord },
      )
      .collect<[Array<{ source: RecordId[] }>]>();

    // THEN the source message is discoverable
    expect(rows.length).toBe(1);
    expect(rows[0]!.source.length).toBe(1);
    expect((rows[0]!.source[0]!.id as string)).toBe(assistantMsg.id as string);
  }, 30_000);

  it("multiple traces per message: one message can spawn multiple trace trees", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-graph-4");
    const conv = await seedConversation(baseUrl, surreal, user, "graph-multi");

    // GIVEN a message that spawned two subagent invocations
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Ran PM agent twice.",
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace({ intent: "plan_work" }),
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTraceMinimal(),
    );

    // WHEN querying spawned traces for the message
    const rootTraces = await querySpawnedTraces(surreal, assistantMsg);

    // THEN both root traces are returned
    expect(rootTraces.length).toBe(2);
    const types = rootTraces.map((t) => t.type);
    expect(types.every((t) => t === "subagent_spawn")).toBe(true);
  }, 30_000);
});
