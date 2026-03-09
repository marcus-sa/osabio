import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

/**
 * Walking Skeleton: Unified Identity Hub-and-Spoke
 *
 * Proves the thinnest vertical slice through the identity model:
 * 1. Identity hub table exists and accepts records
 * 2. Agent spoke table exists and accepts records
 * 3. Spoke edges connect hub to spoke (identity_person, identity_agent)
 * 4. Graph traversal works from identity -> spoke -> spoke record
 *
 * This is the FIRST test to enable. All other unified-identity tests
 * remain skipped until this skeleton passes.
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

let workspaceRecord: RecordId<"workspace", string>;
let personRecord: RecordId<"person", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_identity_skeleton_${runId}`;
  database = `skeleton_${Math.floor(Math.random() * 100000)}`;

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

  // Create workspace
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Identity Skeleton Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // Create person (existing spoke target)
  personRecord = new RecordId("person", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: personRecord,
    content: {
      name: "Marcus Oliveira",
      contact_email: "marcus@conductor.dev",
      created_at: now,
      updated_at: now,
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

describe("Walking Skeleton: identity hub-and-spoke model delivers unified actor lookup", () => {
  it("Given a workspace with a person, when a human identity hub is created and linked via spoke edge, then traversal from identity reaches the person record", async () => {
    const now = new Date();

    // Create identity hub for human
    const identityRecord = new RecordId("identity", `marcus-human-${randomUUID()}`);
    await surreal.query("CREATE $record CONTENT $content;", {
      record: identityRecord,
      content: {
        name: "Marcus Oliveira",
        type: "human",
        role: "owner",
        workspace: workspaceRecord,
        created_at: now,
      },
    });

    // Create spoke edge: identity -> person
    await surreal.query(
      "RELATE $identity->identity_person->$person SET added_at = $now;",
      { identity: identityRecord, person: personRecord, now },
    );

    // Verify: identity record exists with correct fields
    const [identity] = await surreal.query<
      [Array<{ name: string; type: string; role: string }>]
    >("SELECT name, type, role FROM $record;", { record: identityRecord });
    expect(identity.length).toBe(1);
    expect(identity[0].name).toBe("Marcus Oliveira");
    expect(identity[0].type).toBe("human");
    expect(identity[0].role).toBe("owner");

    // Verify: spoke traversal from identity reaches person
    const [personViaSpoke] = await surreal.query<
      [Array<{ spoke: Array<{ name: string; contact_email: string }> }>]
    >(
      "SELECT ->identity_person->person.{ name, contact_email } AS spoke FROM $record;",
      { record: identityRecord },
    );
    expect(personViaSpoke.length).toBe(1);
    expect(personViaSpoke[0].spoke.length).toBe(1);
    expect(personViaSpoke[0].spoke[0].name).toBe("Marcus Oliveira");
    expect(personViaSpoke[0].spoke[0].contact_email).toBe("marcus@conductor.dev");
  }, 60_000);

  it("Given a human identity exists, when an agent identity is created with managed_by pointing to the human, then the managed_by chain resolves to a human in one hop", async () => {
    const now = new Date();

    // Create human identity (the manager)
    const humanIdentity = new RecordId("identity", `owner-${randomUUID()}`);
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

    // Create agent spoke
    const agentRecord = new RecordId("agent", `pm-${randomUUID()}`);
    await surreal.query("CREATE $record CONTENT $content;", {
      record: agentRecord,
      content: {
        agent_type: "management",
        model: "claude-sonnet-4-20250514",
        managed_by: humanIdentity,
        created_at: now,
      },
    });

    // Create agent identity hub
    const agentIdentity = new RecordId("identity", `pm-agent-${randomUUID()}`);
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

    // Create spoke edge: identity -> agent
    await surreal.query(
      "RELATE $identity->identity_agent->$agent SET added_at = $now;",
      { identity: agentIdentity, agent: agentRecord, now },
    );

    // Verify: managed_by chain resolves from agent identity to human identity
    const [chain] = await surreal.query<
      [Array<{ managed_by: RecordId; manager_type: string; manager_name: string }>]
    >(
      `SELECT
        ->identity_agent->agent.managed_by AS managed_by,
        ->identity_agent->agent.managed_by.type AS manager_type,
        ->identity_agent->agent.managed_by.name AS manager_name
      FROM $record;`,
      { record: agentIdentity },
    );

    expect(chain.length).toBe(1);
    // managed_by resolves to the human identity in 1 hop
    const managerTypes = chain[0].manager_type as unknown as string[];
    const managerNames = chain[0].manager_name as unknown as string[];
    expect(managerTypes[0]).toBe("human");
    expect(managerNames[0]).toBe("Marcus Oliveira");
  }, 60_000);

  it("Given both human and agent identities exist in a workspace, when querying all identities for the workspace, then both appear with correct types", async () => {
    const now = new Date();

    // Create a fresh pair of identities for this assertion
    const humanId = new RecordId("identity", `ws-human-${randomUUID()}`);
    const agentId = new RecordId("identity", `ws-agent-${randomUUID()}`);

    await surreal.query("CREATE $record CONTENT $content;", {
      record: humanId,
      content: {
        name: "Ana Torres",
        type: "human",
        role: "owner",
        workspace: workspaceRecord,
        created_at: now,
      },
    });

    await surreal.query("CREATE $record CONTENT $content;", {
      record: agentId,
      content: {
        name: "Code Agent",
        type: "agent",
        role: "coder",
        workspace: workspaceRecord,
        created_at: now,
      },
    });

    // Query all identities in workspace
    const [identities] = await surreal.query<
      [Array<{ name: string; type: string; role: string }>]
    >(
      "SELECT name, type, role FROM identity WHERE workspace = $ws;",
      { ws: workspaceRecord },
    );

    const names = identities.map((i) => i.name);
    const types = identities.map((i) => i.type);

    expect(names).toContain("Ana Torres");
    expect(names).toContain("Code Agent");
    expect(types).toContain("human");
    expect(types).toContain("agent");
  }, 60_000);
});
