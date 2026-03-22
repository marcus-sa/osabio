import { describe, expect, it, mock } from "bun:test";
import { captureToolTrace } from "../../app/src/server/proxy/tool-trace-writer";

describe("captureToolTrace", () => {
  it("creates invoked edge from agent_session to trace when sessionId is provided", async () => {
    const queries: Array<{ sql: string; vars: Record<string, unknown> }> = [];

    const query = mock(async (sql: string, vars?: Record<string, unknown>) => {
      queries.push({ sql, vars: vars ?? {} });
      return [];
    });

    const surreal = { query } as unknown as import("surrealdb").Surreal;

    await captureToolTrace(
      {
        toolName: "search_entities",
        workspaceId: "ws-001",
        identityId: "id-001",
        sessionId: "sess-001",
        outcome: "success",
        durationMs: 42,
      },
      { surreal },
    );

    const invokedQuery = queries.find((q) => q.sql.includes("->invoked->"));
    expect(invokedQuery).toBeDefined();
    expect(invokedQuery!.sql).toContain("RELATE $sess->invoked->$trace");

    const sess = invokedQuery!.vars.sess as import("surrealdb").RecordId;
    expect(sess.table.name).toBe("agent_session");
    expect(sess.id as string).toBe("sess-001");

    const trace = invokedQuery!.vars.trace as import("surrealdb").RecordId;
    expect(trace.table.name).toBe("trace");
  });

  it("creates scoped_to edge from trace to workspace", async () => {
    const queries: Array<{ sql: string; vars: Record<string, unknown> }> = [];

    const query = mock(async (sql: string, vars?: Record<string, unknown>) => {
      queries.push({ sql, vars: vars ?? {} });
      return [];
    });

    const surreal = { query } as unknown as import("surrealdb").Surreal;

    await captureToolTrace(
      {
        toolName: "search_entities",
        workspaceId: "ws-002",
        outcome: "success",
        durationMs: 10,
      },
      { surreal },
    );

    const scopedQuery = queries.find((q) => q.sql.includes("->scoped_to->"));
    expect(scopedQuery).toBeDefined();
    expect(scopedQuery!.sql).toContain("RELATE $trace->scoped_to->$workspace");

    const ws = scopedQuery!.vars.workspace as import("surrealdb").RecordId;
    expect(ws.table.name).toBe("workspace");
    expect(ws.id as string).toBe("ws-002");
  });

  it("does NOT create invoked edge when sessionId is omitted", async () => {
    const queries: Array<{ sql: string; vars: Record<string, unknown> }> = [];

    const query = mock(async (sql: string, vars?: Record<string, unknown>) => {
      queries.push({ sql, vars: vars ?? {} });
      return [];
    });

    const surreal = { query } as unknown as import("surrealdb").Surreal;

    await captureToolTrace(
      {
        toolName: "get_entity_detail",
        workspaceId: "ws-003",
        outcome: "error",
        durationMs: 5,
      },
      { surreal },
    );

    const invokedQuery = queries.find((q) => q.sql.includes("->invoked->"));
    expect(invokedQuery).toBeUndefined();
  });
});
