import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";
import { checkAuthority } from "../../../app/src/server/iam/authority";
import { resolveByEmail } from "../../../app/src/server/iam/identity";
import { resolveWorkspaceIdentity } from "../../../app/src/server/extraction/identity-resolution";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_auth_${runId}`;
  database = `authority_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  // Apply base schema (canonical full schema — migrations are for evolving existing DBs)
  await applyTestSchema(surreal);
}, 30_000);

afterAll(async () => {
  if (!process.env.SMOKE_KEEP_DB) {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
    } catch {}
    try {
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } catch {}
  }
  surreal.close();
});

describe("checkAuthority", () => {
  it("returns global default for create_task (auto)", async () => {
    const result = await checkAuthority({
      surreal,

      action: "create_task",
    });
    expect(result).toBe("auto");
  });

  it("returns global default for confirm_decision (blocked)", async () => {
    const result = await checkAuthority({
      surreal,

      action: "confirm_decision",
    });
    expect(result).toBe("blocked");
  });

  it("returns global default for create_decision (provisional)", async () => {
    const result = await checkAuthority({
      surreal,

      action: "create_decision",
    });
    expect(result).toBe("provisional");
  });

  it("returns global default for create_observation (auto)", async () => {
    const result = await checkAuthority({
      surreal,

      action: "create_observation",
    });
    expect(result).toBe("auto");
  });

  it("returns blocked for unknown action", async () => {
    const result = await checkAuthority({
      surreal,

      // @ts-expect-error — testing unknown action fallback
      action: "nonexistent_action",
    });
    expect(result).toBe("blocked");
  });

  it("per-identity authorized_to edge overrides global default", async () => {
    const workspaceRecord = new RecordId("workspace", "test-ws-override");
    await surreal.create(workspaceRecord).content({
      name: "test-override",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
    });

    // Global default for confirm_decision is blocked
    const globalResult = await checkAuthority({
      surreal,

      action: "confirm_decision",
    });
    expect(globalResult).toBe("blocked");

    // Create an agent identity with an authorized_to override granting auto
    const identityRecord = new RecordId("identity", `test-override-${randomUUID()}`);
    await surreal.create(identityRecord).content({
      name: "Override Agent",
      type: "agent",
      role: "custom",
      workspace: workspaceRecord,
      created_at: new Date(),
    });

    const [scopeRows] = await surreal.query<[Array<{ id: RecordId }>]>(
      "SELECT id FROM authority_scope WHERE action = 'confirm_decision' AND workspace IS NONE LIMIT 1;",
    );

    await surreal.relate(
      identityRecord,
      new RecordId("authorized_to", randomUUID()),
      scopeRows[0].id,
      { permission: "auto", created_at: new Date() },
    ).output("after");

    // With identity, override should win
    const overrideResult = await checkAuthority({
      surreal,

      action: "confirm_decision",
      workspaceRecord,
      identityRecord,
    });
    expect(overrideResult).toBe("auto");
  });
});

describe("identity resolution", () => {
  it("resolveByEmail finds person by case-insensitive email", async () => {
    const workspaceRecord = new RecordId("workspace", "test-ws-identity");
    const personRecord = new RecordId("person", "test-person-email");

    await surreal.create(workspaceRecord).content({
      name: "test-identity",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
    });

    await surreal.create(personRecord).content({
      name: "Test User",
      contact_email: "Test@Example.com",
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const identityRecord = new RecordId("identity", "test-identity-email");
    await surreal.create(identityRecord).content({
      name: "Test User",
      type: "human",
      workspace: workspaceRecord,
      created_at: new Date(),
    });

    await surreal
      .relate(identityRecord, new RecordId("identity_person", "test-spoke"), personRecord, {
        added_at: new Date(),
      })
      .output("after");

    await surreal
      .relate(identityRecord, new RecordId("member_of", "test-membership"), workspaceRecord, {
        role: "member",
        added_at: new Date(),
      })
      .output("after");

    const result = await resolveByEmail({
      surreal,
      email: "test@example.com",
      workspaceRecord,
    });

    expect(result).toBeDefined();
    expect(result!.id).toBe("test-identity-email");
  });

  it("resolveByEmail returns undefined for non-member", async () => {
    const workspaceRecord = new RecordId("workspace", "test-ws-nonmember");
    const personRecord = new RecordId("person", "test-person-nonmember");

    await surreal.create(workspaceRecord).content({
      name: "test-nonmember",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
    });

    await surreal.create(personRecord).content({
      name: "Outsider",
      contact_email: "outsider@example.com",
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // No identity or member_of edge for this person

    const result = await resolveByEmail({
      surreal,
      email: "outsider@example.com",
      workspaceRecord,
    });

    expect(result).toBeUndefined();
  });

  it("resolveWorkspaceIdentity resolves by name and rejects unknown", async () => {
    const workspaceRecord = new RecordId("workspace", "test-ws-composite");

    await surreal.create(workspaceRecord).content({
      name: "test-composite",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
    });

    const identityRecord = new RecordId("identity", "test-identity-composite");
    await surreal.create(identityRecord).content({
      name: "Alice",
      type: "human",
      workspace: workspaceRecord,
      created_at: new Date(),
    });

    await surreal
      .relate(identityRecord, new RecordId("member_of", "test-composite-member"), workspaceRecord, {
        role: "member",
        added_at: new Date(),
      })
      .output("after");

    // Name match (resolves via identity table)
    const byName = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord,
      identityName: "Alice",
    });
    expect(byName).toBeDefined();
    expect(byName!.id).toBe("test-identity-composite");

    // No match
    const noMatch = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord,
      identityName: "nobody",
    });
    expect(noMatch).toBeUndefined();
  });
});
