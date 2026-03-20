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
      // Similarity linking query — return no matches
      query: async () => [null, []],
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
