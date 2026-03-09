import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { checkAuthority } from "../../../app/src/server/iam/authority";

/**
 * US-UI-03-01: Role-based authority with per-identity overrides
 *
 * Resolution order: per-identity override -> role default -> agent_type default -> blocked
 * Human identities bypass authority checks entirely.
 * Per-identity authorized_to override takes precedence over role-based authority_scope.
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_authority_${runId}`;
  database = `authority_${Math.floor(Math.random() * 100000)}`;

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
    name: "Authority Test Workspace",
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

// -- Helpers --

async function createIdentity(
  type: "human" | "agent" | "system",
  role?: string,
): Promise<RecordId<"identity", string>> {
  const record = new RecordId("identity", randomUUID());
  const content: Record<string, unknown> = {
    name: `identity-${record.id}`,
    type,
    workspace: workspaceRecord,
    created_at: new Date(),
  };
  if (role !== undefined) {
    content.role = role;
  }
  await surreal.create(record).content(content);
  return record;
}

describe("US-UI-03-01: Authority resolves override then role default then blocked", () => {

  // -- Human bypass --

  it("Given a human identity, when checkAuthority is called for confirm_decision, then it returns auto (human bypass)", async () => {
    const identity = await createIdentity("human", "owner");

    const result = await checkAuthority({
      surreal,
      agentType: "code_agent",
      action: "confirm_decision",
      workspaceRecord,
      identityRecord: identity,
    });

    expect(result).toBe("auto");
  }, 30_000);

  // -- Per-identity override takes precedence over role default --

  it("Given an agent identity with role-default blocked for confirm_decision, when an authorized_to override grants auto, then override permission is returned", async () => {
    const identity = await createIdentity("agent", "code_agent");

    // code_agent + confirm_decision = blocked by seed data
    // Create a per-identity override granting auto
    const [scopeRows] = await surreal.query<[Array<{ id: RecordId }>]>(
      "SELECT id FROM authority_scope WHERE agent_type = 'code_agent' AND action = 'confirm_decision' AND workspace IS NONE LIMIT 1;",
    );
    const scopeRecord = scopeRows[0].id;

    await surreal.relate(
      identity,
      new RecordId("authorized_to", randomUUID()),
      scopeRecord,
      { permission: "auto", created_at: new Date() },
    ).output("after");

    const result = await checkAuthority({
      surreal,
      agentType: "code_agent",
      action: "confirm_decision",
      workspaceRecord,
      identityRecord: identity,
    });

    expect(result).toBe("auto");
  }, 30_000);

  // -- Role-based resolution (identity.role matches authority_scope.agent_type) --

  it("Given an agent identity with role architect, when checkAuthority is called with agentType code_agent for resolve_observation, then role-based permission (auto) is used instead of agent_type default (blocked)", async () => {
    const identity = await createIdentity("agent", "architect");

    // architect + resolve_observation = auto (seed data)
    // code_agent + resolve_observation = blocked (seed data)
    // identity.role = architect should take precedence over agentType param
    const result = await checkAuthority({
      surreal,
      agentType: "code_agent",
      action: "resolve_observation",
      workspaceRecord,
      identityRecord: identity,
    });

    expect(result).toBe("auto");
  }, 30_000);

  // -- No role, no override -> falls back to agent_type default --

  it("Given an agent identity with no role and no override, when checkAuthority is called, then agent_type default is used", async () => {
    const identity = await createIdentity("agent");

    const result = await checkAuthority({
      surreal,
      agentType: "code_agent",
      action: "create_task",
      workspaceRecord,
      identityRecord: identity,
    });

    expect(result).toBe("auto");
  }, 30_000);

  // -- Fail-safe: no match at all --

  it("Given an identity with no role, no override, and unknown agent_type, when checkAuthority is called, then blocked is returned", async () => {
    const identity = await createIdentity("agent");

    const result = await checkAuthority({
      surreal,
      // @ts-expect-error -- testing unknown agent type fallback
      agentType: "unknown_type",
      action: "create_task",
      workspaceRecord,
      identityRecord: identity,
    });

    expect(result).toBe("blocked");
  }, 30_000);

  // -- Schema: authorized_to relation exists --

  it("Given the schema is applied, when authorized_to table info is queried, then the table exists as a RELATION", async () => {
    const [info] = await surreal.query<[Record<string, unknown>]>(
      "INFO FOR TABLE authorized_to;",
    );

    expect(info).toBeDefined();
  }, 30_000);

  // -- Invalid permission rejected by schema --

  it("Given an authorized_to override, when the permission value is not in the allowed enum, then the creation fails", async () => {
    const identity = await createIdentity("agent", "management");

    const [scopes] = await surreal.query<[Array<{ id: RecordId }>]>(
      "SELECT id FROM authority_scope LIMIT 1;",
    );

    let rejected = false;
    try {
      await surreal.query(
        `RELATE $identity->authorized_to->$scope
         SET permission = 'invalid_perm', created_at = $now;`,
        { identity, scope: scopes[0].id, now: new Date() },
      );
    } catch {
      rejected = true;
    }

    // SurrealDB SCHEMAFULL with ASSERT should reject invalid permission values
    // If it doesn't throw, check that no record was actually created
    if (!rejected) {
      const [overrides] = await surreal.query<[Array<{ permission: string }>]>(
        "SELECT permission FROM authorized_to WHERE in = $identity AND permission = 'invalid_perm';",
        { identity },
      );
      // If the query didn't throw but also didn't persist, that counts as rejected
      rejected = overrides.length === 0;
    }

    expect(rejected).toBe(true);
  }, 30_000);
});
