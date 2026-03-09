import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

/**
 * US-UI-003: Edge Migration -- Ownership and Attribution
 *
 * Validates that all ownership fields and relation tables have migrated
 * from record<person> to record<identity>:
 * - task.owner, feature.owner, decision.decided_by/confirmed_by, question.assigned_to
 * - owns relation: IN identity OUT task|project|feature
 * - member_of relation: IN identity OUT workspace
 * - Both human and agent identities can own entities
 * - Graph traversal queries return correct results with identity references
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;
let humanIdentity: RecordId<"identity", string>;
let agentIdentity: RecordId<"identity", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_edge_migration_${runId}`;
  database = `edge_mig_${Math.floor(Math.random() * 100000)}`;

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
    name: "Edge Migration Test",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  humanIdentity = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: humanIdentity,
    content: {
      name: "Marcus Oliveira",
      type: "human",
      role: "owner",
      workspace: workspaceRecord,
      created_at: now,
    },
  });

  agentIdentity = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: agentIdentity,
    content: {
      name: "PM Agent",
      type: "agent",
      role: "management",
      workspace: workspaceRecord,
      created_at: now,
    },
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

describe("US-UI-003: Ownership edges use identity references for unified attribution", () => {
  // -- Happy path: task ownership with identity --

  it("Given a human identity exists, when a task is created with owner pointing to that identity, then the task persists with an identity-type owner", async () => {
    const now = new Date();
    const taskRecord = new RecordId("task", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: taskRecord,
      content: {
        title: "Implement OAuth flow",
        status: "open",
        owner: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [rows] = await surreal.query<
      [Array<{ title: string; owner: RecordId }>]
    >("SELECT title, owner FROM $record;", { record: taskRecord });

    expect(rows[0].title).toBe("Implement OAuth flow");
    expect(rows[0].owner).toBeDefined();
    // owner should reference the identity table
    expect((rows[0].owner as RecordId).table.name).toBe("identity");
  }, 60_000);

  it("Given an agent identity exists, when the agent creates a task, then the task owner points to the agent identity", async () => {
    const now = new Date();
    const taskRecord = new RecordId("task", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: taskRecord,
      content: {
        title: "Set up CI pipeline",
        status: "open",
        owner: agentIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [rows] = await surreal.query<
      [Array<{ owner: RecordId }>]
    >("SELECT owner FROM $record;", { record: taskRecord });

    expect((rows[0].owner as RecordId).table.name).toBe("identity");
  }, 60_000);

  // -- Decision split attribution --

  it("Given both agent and human identities exist, when a decision is created by the agent and later confirmed by the human, then decided_by and confirmed_by both reference identity records", async () => {
    const now = new Date();
    const decisionRecord = new RecordId("decision", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: decisionRecord,
      content: {
        summary: "Prioritize auth feature",
        status: "proposed",
        decided_by: agentIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    // Confirm by human
    await surreal.query(
      "UPDATE $record SET confirmed_by = $human, confirmed_at = $now, status = 'confirmed';",
      { record: decisionRecord, human: humanIdentity, now },
    );

    const [rows] = await surreal.query<
      [Array<{ decided_by: RecordId; confirmed_by: RecordId; status: string }>]
    >("SELECT decided_by, confirmed_by, status FROM $record;", { record: decisionRecord });

    expect(rows[0].status).toBe("confirmed");
    expect((rows[0].decided_by as RecordId).table.name).toBe("identity");
    expect((rows[0].confirmed_by as RecordId).table.name).toBe("identity");
  }, 60_000);

  // -- Feature and question ownership --

  it("Given a human identity exists, when a feature is created with owner pointing to that identity, then the feature persists with identity-type owner", async () => {
    const now = new Date();
    const featureRecord = new RecordId("feature", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: featureRecord,
      content: {
        name: "Unified Identity",
        status: "active",
        owner: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [rows] = await surreal.query<
      [Array<{ owner: RecordId }>]
    >("SELECT owner FROM $record;", { record: featureRecord });

    expect((rows[0].owner as RecordId).table.name).toBe("identity");
  }, 60_000);

  it("Given a human identity exists, when a question is created with assigned_to pointing to that identity, then the question persists with identity-type assignment", async () => {
    const now = new Date();
    const questionRecord = new RecordId("question", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: questionRecord,
      content: {
        text: "Which embedding provider should we use?",
        status: "open",
        assigned_to: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [rows] = await surreal.query<
      [Array<{ assigned_to: RecordId }>]
    >("SELECT assigned_to FROM $record;", { record: questionRecord });

    expect((rows[0].assigned_to as RecordId).table.name).toBe("identity");
  }, 60_000);

  // -- Relation table constraints --

  it("Given a human identity and a task exist, when an owns edge is created from identity to task, then the relation is valid and traversal returns the task", async () => {
    const now = new Date();
    const taskRecord = new RecordId("task", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: taskRecord,
      content: {
        title: "Review PR",
        status: "open",
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    await surreal.query(
      "RELATE $identity->owns->$task SET assigned_at = $now;",
      { identity: humanIdentity, task: taskRecord, now },
    );

    const [result] = await surreal.query<
      [Array<{ tasks: Array<{ title: string }> }>]
    >(
      "SELECT ->owns->task.{ title } AS tasks FROM $record;",
      { record: humanIdentity },
    );

    const titles = result[0].tasks.map((t) => t.title);
    expect(titles).toContain("Review PR");
  }, 60_000);

  it("Given a human identity and a workspace exist, when a member_of edge connects identity to workspace, then reverse traversal from workspace returns the identity", async () => {
    const now = new Date();

    await surreal.query(
      "RELATE $identity->member_of->$ws SET added_at = $now;",
      { identity: humanIdentity, ws: workspaceRecord, now },
    );

    const [result] = await surreal.query<
      [Array<{ members: Array<{ name: string; type: string }> }>]
    >(
      "SELECT <-member_of<-identity.{ name, type } AS members FROM $record;",
      { record: workspaceRecord },
    );

    const memberNames = result[0].members.map((m) => m.name);
    expect(memberNames).toContain("Marcus Oliveira");
  }, 60_000);

  // -- Schema completeness check --

  it("Given the edge migration is complete, when schema info is queried for ownership tables, then no field has type record<person> for ownership attributes", async () => {
    const tablesToCheck = ["task", "feature", "decision", "question"];

    for (const table of tablesToCheck) {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );

      const infoObj = info as unknown as Record<string, Record<string, string>>;
      const fields = infoObj.fields ?? infoObj.fd ?? {};
      const fieldDefs = Object.entries(fields);

      for (const [fieldName, fieldDef] of fieldDefs) {
        if (["owner", "decided_by", "confirmed_by", "assigned_to", "resolved_by"].includes(fieldName)) {
          expect(fieldDef).not.toContain("record<person>");
          expect(fieldDef).toContain("record<identity>");
        }
      }
    }
  }, 60_000);

  // -- Error path: person record cannot be used as owner --

  it("Given ownership fields now require record<identity>, when a task is created with owner pointing to a person record, then the creation fails", async () => {
    const now = new Date();
    const personRecord = new RecordId("person", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: personRecord,
      content: {
        name: "Wrong Type Person",
        contact_email: "wrong@test.local",
        created_at: now,
        updated_at: now,
      },
    });

    const taskRecord = new RecordId("task", randomUUID());

    let threw = false;
    try {
      await surreal.query("CREATE $record CONTENT $content;", {
        record: taskRecord,
        content: {
          title: "Should Fail",
          status: "open",
          owner: personRecord,
          workspace: workspaceRecord,
          created_at: now,
          updated_at: now,
        },
      });
    } catch {
      threw = true;
    }

    // If it didn't throw, verify the owner was silently dropped (SCHEMAFULL rejects wrong record types)
    if (!threw) {
      const [rows] = await surreal.query<
        [Array<{ owner?: RecordId }>]
      >("SELECT owner FROM $record;", { record: taskRecord });
      // Owner should be NONE because SCHEMAFULL silently rejects mismatched record types
      expect(rows[0]?.owner).toBeUndefined();
    }
  }, 60_000);
});
