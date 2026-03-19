import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  acknowledgeObservation,
  createObservation,
  listWorkspaceOpenObservations,
  resolveObservation,
} from "../../app/src/server/observation/queries";

describe("observation queries", () => {
  it("creates an observation and relates it to a target entity", async () => {
    const createdPayloads: unknown[] = [];
    const relateCalls: Array<{ in: RecordId<"observation", string>; out: RecordId<string, string>; edge: RecordId<"observes", string>; payload: unknown }> = [];

    const surrealMock = {
      create: (_record: RecordId<"observation", string>) => ({
        content: async (payload: unknown) => {
          createdPayloads.push(payload);
        },
      }),
      relate: (
        inRecord: RecordId<"observation", string>,
        edgeRecord: RecordId<"observes", string>,
        outRecord: RecordId<string, string>,
        payload: unknown,
      ) => {
        relateCalls.push({
          in: inRecord,
          edge: edgeRecord,
          out: outRecord,
          payload,
        });
        return {
          output: async () => ({ id: edgeRecord }),
        };
      },
    };

    const workspaceRecord = new RecordId("workspace", "w-1");
    const sourceMessageRecord = new RecordId("message", "m-1");
    const taskRecord = new RecordId("task", "t-1");

    const observationRecord = await createObservation({
      surreal: surrealMock as any,
      workspaceRecord,
      text: "Auth implementation blocks launch.",
      severity: "warning",
      category: "engineering",
      sourceAgent: "chat_agent",
      now: new Date("2026-01-15T10:00:00.000Z"),
      sourceMessageRecord,
      relatedRecords: [taskRecord],
      embedding: [0.1, 0.2, 0.3],
    });

    expect(observationRecord.table.name).toBe("observation");
    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({
      text: "Auth implementation blocks launch.",
      severity: "warning",
      category: "engineering",
      status: "open",
      source_agent: "chat_agent",
      workspace: workspaceRecord,
      source_message: sourceMessageRecord,
      embedding: [0.1, 0.2, 0.3],
      occurrence_count: 1,
    });

    expect(relateCalls).toHaveLength(1);
    expect(relateCalls[0]?.in.table.name).toBe("observation");
    expect(relateCalls[0]?.edge.table.name).toBe("observes");
    expect(relateCalls[0]?.out).toBe(taskRecord);
  });

  it("fails acknowledging an out-of-scope observation", async () => {
    const surrealMock = {
      select: async () => ({ workspace: new RecordId("workspace", "w-other") }),
      update: () => ({
        merge: async () => undefined,
      }),
    };

    await expect(
      acknowledgeObservation({
        surreal: surrealMock as any,
        workspaceRecord: new RecordId("workspace", "w-1"),
        observationRecord: new RecordId("observation", "o-1"),
        now: new Date(),
      }),
    ).rejects.toThrow("outside the current workspace scope");
  });

  it("resolves a scoped observation", async () => {
    const mergePayloads: unknown[] = [];
    const workspaceRecord = new RecordId("workspace", "w-1");
    const ownerRecord = new RecordId("person", "p-1");

    const surrealMock = {
      select: async () => ({ workspace: workspaceRecord }),
      update: (_record: RecordId<"observation", string>) => ({
        merge: async (payload: unknown) => {
          mergePayloads.push(payload);
        },
      }),
    };

    await resolveObservation({
      surreal: surrealMock as any,
      workspaceRecord,
      observationRecord: new RecordId("observation", "o-1"),
      now: new Date("2026-02-01T09:00:00.000Z"),
      resolvedByRecord: ownerRecord,
    });

    expect(mergePayloads).toHaveLength(1);
    expect(mergePayloads[0]).toMatchObject({
      status: "resolved",
      resolved_by: ownerRecord,
    });
  });

  it("deduplicates when KNN finds a similar open observation", async () => {
    const existingId = new RecordId("observation", "existing-obs");
    const updateQueries: Array<{ sql: string; vars: unknown }> = [];

    const surrealMock = {
      query: async (sql: string, vars: unknown) => {
        // First call: KNN dedup query — return a match
        if (sql.includes("embedding <|10, COSINE|>")) {
          return [null, [{ id: existingId, occurrence_count: 2, similarity: 0.98 }]];
        }
        // Second call: UPDATE occurrence_count
        updateQueries.push({ sql, vars });
        return [];
      },
      // Should NOT be called — dedup should merge
      create: () => { throw new Error("create should not be called during dedup merge"); },
    };

    const result = await createObservation({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w-1"),
      text: "Duplicate observation text",
      severity: "warning",
      sourceAgent: "observer_agent",
      sourceSessionRecord: new RecordId("agent_session", "s-1"),
      now: new Date("2026-02-01T12:00:00.000Z"),
      embedding: [0.5, 0.6, 0.7],
    });

    // Should return existing ID, not create new
    expect(result).toBe(existingId);
    // Should have called UPDATE to increment occurrence_count
    expect(updateQueries).toHaveLength(1);
    expect(updateQueries[0].sql).toContain("occurrence_count = occurrence_count + 1");
  });

  it("skips dedup when no session is provided", async () => {
    const createdPayloads: unknown[] = [];

    const surrealMock = {
      // query should NOT be called — no session means no dedup attempt
      query: () => { throw new Error("query should not be called without session"); },
      create: () => ({
        content: async (payload: unknown) => {
          createdPayloads.push(payload);
        },
      }),
      relate: () => ({
        output: async () => ({}),
      }),
    };

    const result = await createObservation({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w-1"),
      text: "Observation without session",
      severity: "info",
      sourceAgent: "observer_agent",
      now: new Date("2026-02-01T12:00:00.000Z"),
      embedding: [0.5, 0.6, 0.7],
    });

    expect(result.table.name).toBe("observation");
    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({ occurrence_count: 1 });
  });

  it("creates new observation without embedding (no dedup possible)", async () => {
    const createdPayloads: unknown[] = [];

    const surrealMock = {
      create: () => ({
        content: async (payload: unknown) => {
          createdPayloads.push(payload);
        },
      }),
      relate: () => ({
        output: async () => ({}),
      }),
    };

    const result = await createObservation({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w-1"),
      text: "No embedding provided",
      severity: "info",
      sourceAgent: "chat_agent",
      now: new Date("2026-02-01T12:00:00.000Z"),
    });

    // No query() call needed — no embedding means no dedup
    expect(result.table.name).toBe("observation");
    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({ occurrence_count: 1 });
  });

  it("creates similar_to edges for cross-agent observations with embeddings", async () => {
    const createdPayloads: unknown[] = [];
    const relateCalls: Array<{ inTable: string; edgeTable: string; outTable: string; payload: unknown }> = [];
    let queryCallCount = 0;

    const similarObsId = new RecordId("observation", "similar-obs");

    const surrealMock = {
      query: async (sql: string) => {
        queryCallCount++;
        // Similarity linking query — return one similar observation
        if (sql.includes("embedding <|10, COSINE|>")) {
          return [null, [{ id: similarObsId, similarity: 0.90 }]];
        }
        return [];
      },
      create: () => ({
        content: async (payload: unknown) => {
          createdPayloads.push(payload);
        },
      }),
      relate: (inRec: RecordId, edgeRec: RecordId, outRec: RecordId, payload: unknown) => {
        relateCalls.push({
          inTable: inRec.table.name,
          edgeTable: edgeRec.table.name,
          outTable: outRec.table.name,
          payload,
        });
        return { output: async () => ({}) };
      },
    };

    await createObservation({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w-1"),
      text: "Cross-agent observation",
      severity: "warning",
      sourceAgent: "observer_agent",
      now: new Date("2026-02-01T12:00:00.000Z"),
      embedding: [0.1, 0.2, 0.3],
      // No session — dedup skipped, but similar_to linking still runs
    });

    expect(createdPayloads).toHaveLength(1);
    // Should have a similar_to edge (in addition to no observes edges since no relatedRecords)
    const similarEdges = relateCalls.filter((c) => c.edgeTable === "similar_to");
    expect(similarEdges).toHaveLength(1);
    expect(similarEdges[0].inTable).toBe("observation");
    expect(similarEdges[0].outTable).toBe("observation");
    expect((similarEdges[0].payload as any).similarity).toBe(0.90);
  });

  it("lists open observations sorted by severity then recency", async () => {
    const surrealMock = {
      query: () => ({
        collect: async () => [[
          {
            id: new RecordId("observation", "o-info"),
            text: "FYI: docs are stale",
            severity: "info",
            status: "open",
            category: "operations",
            source_agent: "pm_agent",
            created_at: "2026-01-01T10:00:00.000Z",
          },
          {
            id: new RecordId("observation", "o-warning"),
            text: "CI queue is slow",
            severity: "warning",
            status: "acknowledged",
            category: "engineering",
            source_agent: "chat_agent",
            created_at: "2026-01-01T11:00:00.000Z",
          },
          {
            id: new RecordId("observation", "o-conflict"),
            text: "Launch date conflicts with dependency freeze",
            severity: "conflict",
            status: "open",
            category: "operations",
            source_agent: "pm_agent",
            created_at: "2026-01-01T09:00:00.000Z",
          },
        ]],
      }),
    };

    const rows = await listWorkspaceOpenObservations({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w-1"),
      limit: 10,
    });

    expect(rows.map((row) => row.id)).toEqual(["o-conflict", "o-warning", "o-info"]);
    expect(rows[0]).toMatchObject({
      text: "Launch date conflicts with dependency freeze",
      severity: "conflict",
      category: "operations",
      sourceAgent: "pm_agent",
    });
    expect(rows[0]?.createdAt).toBe("2026-01-01T09:00:00.000Z");
  });
});
