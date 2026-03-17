import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `accept_reactive_schema_${runId}`;
  database = `schema_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  // Apply base schema only -- new fields come from migration
  const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schemaSql);

  // Apply the reactive coordination migration
  const migrationPath = join(process.cwd(), "schema", "migrations", "0053_reactive_coordination_fields.surql");
  const migrationSql = readFileSync(migrationPath, "utf8");
  await surreal.query(migrationSql);

  const now = new Date();
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Reactive Schema Test",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });
}, 60_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

describe("Step 01-01: Reactive coordination schema fields", () => {
  it("agent_session accepts last_request_at datetime field", async () => {
    const now = new Date();
    const sessionId = new RecordId("agent_session", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: sessionId,
      content: {
        agent: "test_agent",
        started_at: now,
        created_at: now,
        workspace: workspaceRecord,
        last_request_at: now,
      },
    });

    const rows = await surreal.query<
      [Array<{ last_request_at: string }>]
    >("SELECT last_request_at FROM $record;", { record: sessionId });
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].last_request_at).toBeDefined();
  });

  it("agent_session allows omitting last_request_at", async () => {
    const now = new Date();
    const sessionId = new RecordId("agent_session", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: sessionId,
      content: {
        agent: "test_agent",
        started_at: now,
        created_at: now,
        workspace: workspaceRecord,
      },
    });

    const rows = await surreal.query<
      [Array<{ last_request_at: unknown }>]
    >("SELECT last_request_at FROM $record;", { record: sessionId });
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].last_request_at).toBeUndefined();
  });

  it("agent accepts description_embedding array field", async () => {
    const now = new Date();
    const identityId = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: identityId,
      content: {
        name: "Test Identity",
        type: "agent",
        role: "member",
        workspace: workspaceRecord,
        created_at: now,
      },
    });

    const agentId = new RecordId("agent", randomUUID());
    const embedding = Array.from({ length: 1536 }, () => Math.random());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: agentId,
      content: {
        agent_type: "code_agent",
        managed_by: identityId,
        created_at: now,
        description_embedding: embedding,
      },
    });

    const rows = await surreal.query<
      [Array<{ description_embedding: number[] }>]
    >("SELECT description_embedding FROM $record;", { record: agentId });
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].description_embedding).toHaveLength(1536);
  });

  it("agent table has HNSW index on description_embedding", async () => {
    const info = await surreal.query<[Record<string, unknown>]>(
      "INFO FOR TABLE agent;"
    );
    const tableInfo = info[0] as Record<string, unknown>;
    const indexes = tableInfo["indexes"] as Record<string, string>;
    expect(indexes).toBeDefined();
    const indexNames = Object.keys(indexes);
    const hnswIndex = indexNames.find((name) =>
      name.includes("description_embedding") || name.includes("agent_embedding")
    );
    expect(hnswIndex).toBeDefined();
    const indexDef = indexes[hnswIndex!];
    expect(indexDef).toContain("HNSW");
    expect(indexDef).toContain("COSINE");
  });
});
