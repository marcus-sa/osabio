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
  namespace = `smoke_identity_schema_${runId}`;
  database = `schema_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schemaSql);

  const now = new Date();
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Schema Test Workspace",
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

describe("US-UI-001: Identity hub-spoke schema", () => {
  it("human identity created", async () => {
    const now = new Date();
    const id = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: id,
      content: { name: "Marcus", type: "human", role: "owner", workspace: workspaceRecord, created_at: now },
    });
    const [rows] = await surreal.query<[Array<{ name: string; type: string; role: string; created_at: string }>]>(
      "SELECT name, type, role, created_at FROM $record;", { record: id },
    );
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Marcus");
    expect(rows[0].type).toBe("human");
    expect(rows[0].role).toBe("owner");
    expect(rows[0].created_at).toBeDefined();
  }, 60_000);

  it("agent identity created", async () => {
    const now = new Date();
    const id = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: id,
      content: { name: "PM Agent", type: "agent", role: "management", workspace: workspaceRecord, created_at: now },
    });
    const [rows] = await surreal.query<[Array<{ type: string }>]>("SELECT type FROM $record;", { record: id });
    expect(rows[0].type).toBe("agent");
  }, 60_000);

  it("system identity created", async () => {
    const now = new Date();
    const id = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: id,
      content: { name: "Job Runner", type: "system", workspace: workspaceRecord, created_at: now },
    });
    const [rows] = await surreal.query<[Array<{ type: string; name: string }>]>(
      "SELECT type, name FROM $record;", { record: id },
    );
    expect(rows[0].type).toBe("system");
    expect(rows[0].name).toBe("Job Runner");
  }, 60_000);

  it("agent spoke with managed_by", async () => {
    const now = new Date();
    const human = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: human,
      content: { name: "Marcus", type: "human", role: "owner", workspace: workspaceRecord, created_at: now },
    });
    const ag = new RecordId("agent", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: ag,
      content: { agent_type: "management", managed_by: human, created_at: now },
    });
    const [rows] = await surreal.query<[Array<{ agent_type: string; managed_by: RecordId }>]>(
      "SELECT agent_type, managed_by FROM $record;", { record: ag },
    );
    expect(rows[0].agent_type).toBe("management");
    expect(rows[0].managed_by).toBeDefined();
  }, 60_000);

  it("identity_person spoke traversal", async () => {
    const now = new Date();
    const identity = new RecordId("identity", randomUUID());
    const person = new RecordId("person", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: identity,
      content: { name: "Ana", type: "human", role: "owner", workspace: workspaceRecord, created_at: now },
    });
    await surreal.query("CREATE $record CONTENT $content;", {
      record: person,
      content: { name: "Ana", contact_email: "ana@test.dev", created_at: now, updated_at: now },
    });
    await surreal.query("RELATE $identity->identity_person->$person SET added_at = $now;", { identity, person, now });
    const [result] = await surreal.query<[Array<{ spoke: Array<{ name: string }> }>]>(
      "SELECT ->identity_person->person.{ name } AS spoke FROM $record;", { record: identity },
    );
    expect(result[0].spoke.length).toBe(1);
    expect(result[0].spoke[0].name).toBe("Ana");
  }, 60_000);

  it("identity_agent spoke traversal", async () => {
    const now = new Date();
    const human = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: human,
      content: { name: "Marcus", type: "human", role: "owner", workspace: workspaceRecord, created_at: now },
    });
    const ag = new RecordId("agent", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: ag,
      content: { agent_type: "management", managed_by: human, created_at: now },
    });
    const agentId = new RecordId("identity", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: agentId,
      content: { name: "PM Agent", type: "agent", role: "management", workspace: workspaceRecord, created_at: now },
    });
    await surreal.query("RELATE $identity->identity_agent->$agent SET added_at = $now;", { identity: agentId, agent: ag, now });
    const [result] = await surreal.query<[Array<{ spoke: Array<{ agent_type: string }> }>]>(
      "SELECT ->identity_agent->agent.{ agent_type } AS spoke FROM $record;", { record: agentId },
    );
    expect(result[0].spoke.length).toBe(1);
    expect(result[0].spoke[0].agent_type).toBe("management");
  }, 60_000);

  it("invalid type bot rejected", async () => {
    const id = new RecordId("identity", randomUUID());
    let threw = false;
    try {
      await surreal.query("CREATE $record CONTENT $content;", {
        record: id, content: { name: "Bad", type: "bot", workspace: workspaceRecord, created_at: new Date() },
      });
    } catch { threw = true; }
    expect(threw).toBe(true);
  }, 60_000);

  it("missing name rejected", async () => {
    const id = new RecordId("identity", randomUUID());
    let threw = false;
    try {
      await surreal.query("CREATE $record CONTENT $content;", {
        record: id, content: { type: "human", workspace: workspaceRecord, created_at: new Date() },
      });
    } catch { threw = true; }
    expect(threw).toBe(true);
  }, 60_000);

  it("agent without managed_by rejected", async () => {
    const ag = new RecordId("agent", randomUUID());
    let threw = false;
    try {
      await surreal.query("CREATE $record CONTENT $content;", {
        record: ag, content: { agent_type: "management", created_at: new Date() },
      });
    } catch { threw = true; }
    expect(threw).toBe(true);
  }, 60_000);

  it("person.identities field removed", async () => {
    const [info] = await surreal.query<[Record<string, unknown>]>("INFO FOR TABLE person;");
    const fields = info as unknown as { fields: Record<string, string> };
    expect(Object.keys(fields.fields)).not.toContain("identities");
  }, 60_000);

  it("identity indexes exist", async () => {
    const [info] = await surreal.query<[Record<string, unknown>]>("INFO FOR TABLE identity;");
    const indexes = info as unknown as { indexes: Record<string, string> };
    const names = Object.keys(indexes.indexes);
    expect(names).toContain("identity_workspace");
    expect(names).toContain("identity_type_workspace");
  }, 60_000);
});
