import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

/**
 * US-UI-005: Dual-Label Audit Trail Query
 *
 * Validates the audit trail queries that return dual-label attribution:
 * - Agent actions show actor identity + accountable human via managed_by chain
 * - Human actions show self as both actor and accountable
 * - Mixed human/agent attribution handled in query results
 * - "Agent suggestions that became tasks" query works with identity references
 * - No unattributed entities in workspace after migration
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
let agentRecord: RecordId<"agent", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_audit_trail_${runId}`;
  database = `audit_${Math.floor(Math.random() * 100000)}`;

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
    name: "Audit Trail Test",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // Human identity
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

  // Agent spoke with managed_by
  agentRecord = new RecordId("agent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: agentRecord,
    content: {
      agent_type: "management",
      model: "claude-sonnet-4-20250514",
      managed_by: humanIdentity,
      created_at: now,
    },
  });

  // Agent identity
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

  // Spoke edge: agent identity -> agent
  await surreal.query(
    "RELATE $identity->identity_agent->$agent SET added_at = $now;",
    { identity: agentIdentity, agent: agentRecord, now },
  );
}, 60_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

describe("US-UI-005: Dual-label audit trail shows actor and accountable human for every action", () => {
  // -- Happy path: agent action with dual-label --

  it("Given the PM Agent created a task, when the task's audit trail is queried, then the result shows actor 'PM Agent' with type 'agent' and accountable human 'Marcus Oliveira'", async () => {
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

    // Dual-label query: resolve owner identity and managed_by chain
    // Step 1: get actor identity
    const [actorRows] = await surreal.query<
      [Array<{ title: string; actor_name: string; actor_type: string; owner_id: RecordId }>]
    >(
      `SELECT title, owner.name AS actor_name, owner.type AS actor_type, owner AS owner_id FROM $record;`,
      { record: taskRecord },
    );

    expect(actorRows[0].actor_name).toBe("PM Agent");
    expect(actorRows[0].actor_type).toBe("agent");

    // Step 2: traverse managed_by chain from agent identity
    const [managedByRows] = await surreal.query<
      [Array<{ managed_by_name: string; managed_by_type: string }>]
    >(
      `SELECT ->identity_agent->agent.managed_by.name AS managed_by_name, ->identity_agent->agent.managed_by.type AS managed_by_type FROM $identity;`,
      { identity: actorRows[0].owner_id },
    );

    expect(managedByRows[0].managed_by_name).toContain("Marcus Oliveira");
    expect(managedByRows[0].managed_by_type).toContain("human");
  }, 60_000);

  // -- Human action: self as accountable --

  it("Given Marcus directly created a decision, when the decision's audit trail is queried, then actor and accountable human are both 'Marcus Oliveira'", async () => {
    const now = new Date();
    const decisionRecord = new RecordId("decision", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: decisionRecord,
      content: {
        summary: "Use SurrealDB for graph storage",
        status: "confirmed",
        decided_by: humanIdentity,
        confirmed_by: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [result] = await surreal.query<
      [Array<{
        actor_name: string;
        actor_type: string;
      }>]
    >(
      `SELECT
        decided_by.name AS actor_name,
        decided_by.type AS actor_type
      FROM $record;`,
      { record: decisionRecord },
    );

    expect(result[0].actor_name).toBe("Marcus Oliveira");
    expect(result[0].actor_type).toBe("human");
    // For human actors, the accountable human is the same person
    // No managed_by chain traversal needed
  }, 60_000);

  // -- Mixed attribution in workspace --

  it("Given both human and agent owned tasks exist, when all tasks are queried with attribution, then each task shows an identity reference with type context", async () => {
    const now = new Date();

    // Human-owned task
    const humanTask = new RecordId("task", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: humanTask,
      content: {
        title: "Review architecture",
        status: "done",
        owner: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    // Agent-owned task
    const agentTask = new RecordId("task", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: agentTask,
      content: {
        title: "Generate status report",
        status: "open",
        owner: agentIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    const [tasks] = await surreal.query<
      [Array<{
        title: string;
        actor_name: string;
        actor_type: string;
        created_at: string;
      }>]
    >(
      `SELECT
        title,
        owner.name AS actor_name,
        owner.type AS actor_type,
        created_at
      FROM task
      WHERE workspace = $ws AND owner != NONE
      ORDER BY created_at DESC;`,
      { ws: workspaceRecord },
    );

    const types = tasks.map((t) => t.actor_type);
    expect(types).toContain("human");
    expect(types).toContain("agent");

    // Every task with an owner has an identity reference
    for (const task of tasks) {
      expect(task.actor_name).toBeDefined();
      expect(task.actor_type).toBeDefined();
      expect(["human", "agent", "system"]).toContain(task.actor_type);
    }
  }, 60_000);

  // -- No unattributed entities --

  it("Given the unified identity migration is complete, when all tasks with owners are queried, then every owner references an identity record (not person or null)", async () => {
    const [tasks] = await surreal.query<
      [Array<{ title: string; owner: RecordId }>]
    >(
      "SELECT title, owner FROM task WHERE workspace = $ws AND owner != NONE;",
      { ws: workspaceRecord },
    );

    for (const task of tasks) {
      expect(task.owner).toBeDefined();
      expect((task.owner as RecordId).table.name).toBe("identity");
    }
  }, 60_000);

  // -- Suggestion-to-task tracking --

  it("Given the PM Agent created a suggestion that was converted to a task, when the suggestion trail is queried, then the suggestion shows the agent actor and the resulting task", async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Create suggestion by agent
    const suggestionRecord = new RecordId("suggestion", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: suggestionRecord,
      content: {
        text: "Prioritize auth feature",
        category: "opportunity",
        rationale: "Auth blocks other features",
        suggested_by: "PM Agent",
        confidence: 0.9,
        status: "converted",
        workspace: workspaceRecord,
        converted_at: now,
        created_at: thirtyDaysAgo,
        updated_at: now,
      },
    });

    // Create task that was converted from suggestion
    const taskRecord = new RecordId("task", randomUUID());
    await surreal.query("CREATE $record CONTENT $content;", {
      record: taskRecord,
      content: {
        title: "Implement OAuth flow",
        status: "done",
        owner: humanIdentity,
        workspace: workspaceRecord,
        created_at: thirtyDaysAgo,
        updated_at: now,
      },
    });

    // Link suggestion -> task via converted_from edge
    await surreal.query(
      "RELATE $task->converted_from->$suggestion SET converted_at = $now;",
      { task: taskRecord, suggestion: suggestionRecord, now },
    );

    // Update suggestion with converted_to
    await surreal.query(
      "UPDATE $record SET converted_to = $task;",
      { record: suggestionRecord, task: taskRecord },
    );

    // Query: suggestions converted to tasks with their outcomes
    const [results] = await surreal.query<
      [Array<{
        suggestion_text: string;
        suggested_by: string;
        task_title: string;
        task_status: string;
        created_at: string;
      }>]
    >(
      `SELECT
        text AS suggestion_text,
        suggested_by,
        converted_to.title AS task_title,
        converted_to.status AS task_status,
        created_at
      FROM suggestion
      WHERE workspace = $ws AND status = 'converted'
      ORDER BY created_at DESC;`,
      { ws: workspaceRecord },
    );

    expect(results.length).toBeGreaterThan(0);
    const authSuggestion = results.find((r) => r.suggestion_text === "Prioritize auth feature");
    expect(authSuggestion).toBeDefined();
    expect(authSuggestion!.suggested_by).toBe("PM Agent");
    expect(authSuggestion!.task_title).toBe("Implement OAuth flow");
    expect(authSuggestion!.task_status).toBe("done");
  }, 60_000);

  // -- Error/edge case: identity with no managed_by (human) --

  it("Given a human identity has no managed_by chain, when the dual-label query is run, then the managed_by traversal returns empty without error", async () => {
    const now = new Date();
    const taskRecord = new RecordId("task", randomUUID());

    await surreal.query("CREATE $record CONTENT $content;", {
      record: taskRecord,
      content: {
        title: "Human-only task",
        status: "open",
        owner: humanIdentity,
        workspace: workspaceRecord,
        created_at: now,
        updated_at: now,
      },
    });

    // Step 1: get actor identity
    const [actorRows] = await surreal.query<
      [Array<{ actor_type: string; owner_id: RecordId }>]
    >(
      `SELECT owner.type AS actor_type, owner AS owner_id FROM $record;`,
      { record: taskRecord },
    );

    expect(actorRows[0].actor_type).toBe("human");

    // Step 2: traverse managed_by chain -- for human identity, no agent spoke exists
    const [managedByRows] = await surreal.query<
      [Array<{ managed_by_chain: Array<unknown> }>]
    >(
      `SELECT ->identity_agent->agent.managed_by AS managed_by_chain FROM $identity;`,
      { identity: actorRows[0].owner_id },
    );

    // managed_by traversal on a human identity yields empty (no agent spoke)
    expect(managedByRows[0].managed_by_chain).toEqual([]);
  }, 60_000);
});
