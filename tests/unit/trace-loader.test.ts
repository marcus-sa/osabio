import { describe, expect, it } from "bun:test";
import { reconstructTraces } from "../../app/src/server/chat/trace-loader";
import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Pure reconstruction logic unit tests
// ---------------------------------------------------------------------------

type MockRootTrace = {
  id: { id: string; table: { name: string } };
  type: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  created_at: Date;
  source_message: Array<{ id: string; table: { name: string } }>;
};

type MockChildTrace = {
  id: { id: string; table: { name: string } };
  type: string;
  parent_trace: { id: string; table: { name: string } };
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  created_at: Date;
};

describe("reconstructTraces: pure transformation from trace rows to SubagentTrace wire format", () => {
  it("returns empty Map for empty input", () => {
    const result = reconstructTraces([], []);
    expect(result.size).toBe(0);
  });

  it("maps root trace with tool_call children to SubagentTrace", () => {
    const rootId = "root-1";
    const msgId = "msg-1";

    const roots: MockRootTrace[] = [
      {
        id: { id: rootId, table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "plan_work" },
        duration_ms: 1500,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const children: MockChildTrace[] = [
      {
        id: { id: "child-1", table: { name: "trace" } },
        type: "tool_call",
        parent_trace: { id: rootId, table: { name: "trace" } },
        tool_name: "search_entities",
        input: { query: "dashboard" },
        output: { results: [] },
        duration_ms: 200,
        created_at: new Date(),
      },
    ];

    const result = reconstructTraces(roots as unknown[], children as unknown[]);
    expect(result.size).toBe(1);

    const traces = result.get(msgId)!;
    expect(traces.length).toBe(1);
    expect(traces[0]!.agentId).toBe("pm_agent");
    expect(traces[0]!.intent).toBe("plan_work");
    expect(traces[0]!.totalDurationMs).toBe(1500);
    expect(traces[0]!.steps.length).toBe(1);
    expect(traces[0]!.steps[0]!.type).toBe("tool_call");
    expect(traces[0]!.steps[0]!.toolName).toBe("search_entities");
    expect(traces[0]!.steps[0]!.argsJson).toBe(JSON.stringify({ query: "dashboard" }));
    expect(traces[0]!.steps[0]!.resultJson).toBe(JSON.stringify({ results: [] }));
    expect(traces[0]!.steps[0]!.durationMs).toBe(200);
  });

  it("maps trace type 'message' to step type 'text'", () => {
    const rootId = "root-2";
    const msgId = "msg-2";

    const roots: MockRootTrace[] = [
      {
        id: { id: rootId, table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "plan_work" },
        duration_ms: 500,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const children: MockChildTrace[] = [
      {
        id: { id: "child-2", table: { name: "trace" } },
        type: "message",
        parent_trace: { id: rootId, table: { name: "trace" } },
        input: { text: "Here is the plan." },
        created_at: new Date(),
      },
    ];

    const result = reconstructTraces(roots as unknown[], children as unknown[]);
    const traces = result.get(msgId)!;
    expect(traces[0]!.steps[0]!.type).toBe("text");
    expect(traces[0]!.steps[0]!.text).toBe("Here is the plan.");
  });

  it("defaults agentId and intent to 'unknown' when input is missing", () => {
    const rootId = "root-3";
    const msgId = "msg-3";

    const roots: MockRootTrace[] = [
      {
        id: { id: rootId, table: { name: "trace" } },
        type: "subagent_spawn",
        duration_ms: 100,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const result = reconstructTraces(roots as unknown[], []);
    const traces = result.get(msgId)!;
    expect(traces[0]!.agentId).toBe("unknown");
    expect(traces[0]!.intent).toBe("unknown");
  });

  it("defaults totalDurationMs to 0 when duration_ms is missing", () => {
    const rootId = "root-4";
    const msgId = "msg-4";

    const roots: MockRootTrace[] = [
      {
        id: { id: rootId, table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "plan_work" },
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const result = reconstructTraces(roots as unknown[], []);
    const traces = result.get(msgId)!;
    expect(traces[0]!.totalDurationMs).toBe(0);
  });

  it("groups multiple roots under the same message", () => {
    const msgId = "msg-5";

    const roots: MockRootTrace[] = [
      {
        id: { id: "root-5a", table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "plan_work" },
        duration_ms: 1000,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
      {
        id: { id: "root-5b", table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "check_status" },
        duration_ms: 400,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const result = reconstructTraces(roots as unknown[], []);
    expect(result.size).toBe(1);
    const traces = result.get(msgId)!;
    expect(traces.length).toBe(2);
  });

  it("groups children correctly across multiple roots", () => {
    const msgId = "msg-6";

    const roots: MockRootTrace[] = [
      {
        id: { id: "root-6a", table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "plan_work" },
        duration_ms: 1000,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
      {
        id: { id: "root-6b", table: { name: "trace" } },
        type: "subagent_spawn",
        input: { agentId: "pm_agent", intent: "check_status" },
        duration_ms: 400,
        created_at: new Date(),
        source_message: [{ id: msgId, table: { name: "message" } }],
      },
    ];

    const children: MockChildTrace[] = [
      {
        id: { id: "child-6a", table: { name: "trace" } },
        type: "tool_call",
        parent_trace: { id: "root-6a", table: { name: "trace" } },
        tool_name: "search_entities",
        input: { query: "test" },
        output: { results: [] },
        duration_ms: 100,
        created_at: new Date(),
      },
      {
        id: { id: "child-6b", table: { name: "trace" } },
        type: "tool_call",
        parent_trace: { id: "root-6b", table: { name: "trace" } },
        tool_name: "get_project_status",
        input: { projectId: "p1" },
        output: { status: "active" },
        duration_ms: 200,
        created_at: new Date(),
      },
    ];

    const result = reconstructTraces(roots as unknown[], children as unknown[]);
    const traces = result.get(msgId)!;
    expect(traces.length).toBe(2);

    const planTrace = traces.find((t) => t.intent === "plan_work")!;
    expect(planTrace.steps.length).toBe(1);
    expect(planTrace.steps[0]!.toolName).toBe("search_entities");

    const statusTrace = traces.find((t) => t.intent === "check_status")!;
    expect(statusTrace.steps.length).toBe(1);
    expect(statusTrace.steps[0]!.toolName).toBe("get_project_status");
  });
});
