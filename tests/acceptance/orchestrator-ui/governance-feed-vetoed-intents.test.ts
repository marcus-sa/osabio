import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

/**
 * Acceptance tests for vetoed intents in the governance feed awareness tier.
 *
 * Covers:
 * - AC-3.1: Vetoed intents within 24h appear in awareness tier
 * - AC-3.2: Feed item entityKind is "intent" and entityName is goal
 * - AC-3.3: Feed item reason includes "Vetoed" and evaluation reason
 * - AC-3.4: Feed item status is "vetoed"
 * - AC-3.5: Feed item offers only "Discuss" action
 * - AC-3.6: Intents vetoed >24h ago are excluded
 * - AC-3.7: Multiple vetoed intents sorted by recency
 * - AC-3.8: No duplicate with blocking tier (pending_veto dedup)
 *
 * These tests exercise the database query layer directly (no HTTP server needed)
 * since the feed queries are the unit under test for governance visualization.
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;
let identityRecord: RecordId<"identity", string>;

// Intent records for different scenarios
let recentVetoedIntentRecord: RecordId<"intent", string>;
let olderVetoedIntentRecord: RecordId<"intent", string>;
let expiredVetoedIntentRecord: RecordId<"intent", string>;
let pendingVetoIntentRecord: RecordId<"intent", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_feed_veto_${runId}`;
  database = `feed_veto_${Math.floor(Math.random() * 100000)}`;

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

  // ── Workspace ──
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Feed Veto Test Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // ── Identity ──
  identityRecord = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: identityRecord,
    content: { name: "Test Agent", type: "agent", workspace: workspaceRecord, created_at: now },
  });

  // Shared trace record
  const traceRecord = new RecordId("trace", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: traceRecord,
    content: { type: "intent_submission", actor: identityRecord, workspace: workspaceRecord, created_at: now },
  });

  const intentBase = {
    reasoning: "test reasoning",
    priority: 50,
    action_spec: { provider: "test", action: "deploy", params: {} },
    trace_id: traceRecord,
    requester: identityRecord,
    workspace: workspaceRecord,
  };

  // ── Intent vetoed 2 hours ago (within 24h window) ──
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  recentVetoedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: recentVetoedIntentRecord,
    content: {
      ...intentBase,
      goal: "Purge cache",
      status: "vetoed",
      veto_reason: "Not approved by admin",
      evaluation: {
        decision: "REJECT",
        risk_score: 85,
        reason: "risk exceeded budget threshold",
        evaluated_at: twoHoursAgo,
        policy_only: false,
      },
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
      updated_at: twoHoursAgo,
    },
  });

  // ── Intent vetoed 8 hours ago (within 24h window) ──
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  olderVetoedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: olderVetoedIntentRecord,
    content: {
      ...intentBase,
      goal: "Delete staging env",
      status: "vetoed",
      veto_reason: "Environment needed for QA",
      evaluation: {
        decision: "REJECT",
        risk_score: 90,
        reason: "destructive action requires approval",
        evaluated_at: eightHoursAgo,
        policy_only: false,
      },
      created_at: new Date(Date.now() - 9 * 60 * 60 * 1000),
      updated_at: eightHoursAgo,
    },
  });

  // ── Intent vetoed 30 hours ago (outside 24h window) ──
  const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
  expiredVetoedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: expiredVetoedIntentRecord,
    content: {
      ...intentBase,
      goal: "Drop production table",
      status: "vetoed",
      veto_reason: "Too dangerous",
      evaluation: {
        decision: "REJECT",
        risk_score: 100,
        reason: "critical data loss risk",
        evaluated_at: thirtyHoursAgo,
        policy_only: true,
      },
      created_at: new Date(Date.now() - 31 * 60 * 60 * 1000),
      updated_at: thirtyHoursAgo,
    },
  });

  // ── Intent still in pending_veto (should not duplicate into awareness) ──
  pendingVetoIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: pendingVetoIntentRecord,
    content: {
      ...intentBase,
      goal: "Scale DB replicas",
      status: "pending_veto",
      veto_expires_at: new Date(Date.now() + 5 * 60 * 1000),
      evaluation: {
        decision: "REJECT",
        risk_score: 70,
        reason: "requires human review",
        evaluated_at: now,
        policy_only: false,
      },
      created_at: now,
      updated_at: now,
    },
  });
}, 30_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

// ─────────────────────────────────────────────────────────────────────────────
// Query helper: simulates the feed query for recently vetoed intents
// ─────────────────────────────────────────────────────────────────────────────

type VetoedIntentRow = {
  id: RecordId<"intent", string>;
  goal: string;
  status: string;
  veto_reason?: string;
  evaluation?: {
    decision: string;
    risk_score: number;
    reason: string;
  };
  updated_at: Date | string;
};

async function listRecentlyVetoedIntents(
  db: Surreal,
  wsRecord: RecordId<"workspace", string>,
  cutoffHours = 24,
): Promise<VetoedIntentRow[]> {
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000);
  const rows = (await db.query(
    `SELECT id, goal, status, veto_reason, evaluation, updated_at
     FROM intent
     WHERE workspace = $ws
       AND status = 'vetoed'
       AND updated_at > $cutoff
     ORDER BY updated_at DESC;`,
    { ws: wsRecord, cutoff },
  )) as Array<VetoedIntentRow[]>;
  return rows[0] ?? [];
}

async function listPendingVetoIntentIds(
  db: Surreal,
  wsRecord: RecordId<"workspace", string>,
): Promise<Set<string>> {
  const rows = (await db.query(
    `SELECT VALUE id FROM intent
     WHERE workspace = $ws AND status = 'pending_veto';`,
    { ws: wsRecord },
  )) as Array<Array<RecordId<"intent", string>>>;
  return new Set((rows[0] ?? []).map((r) => `intent:${r.id as string}`));
}

type AwarenessFeedItem = {
  entityId: string;
  entityKind: string;
  entityName: string;
  reason: string;
  status: string;
  actions: Array<{ action: string; label: string }>;
};

function mapVetoedIntentToFeedItem(row: VetoedIntentRow): AwarenessFeedItem {
  const evalReason = row.evaluation?.reason ?? "";
  return {
    entityId: `intent:${row.id.id as string}`,
    entityKind: "intent",
    entityName: row.goal,
    reason: `Vetoed: ${evalReason}`,
    status: "vetoed",
    actions: [{ action: "discuss", label: "Discuss" }],
  };
}

function buildAwarenessTier(
  vetoedRows: VetoedIntentRow[],
  blockingEntityIds: Set<string>,
): AwarenessFeedItem[] {
  const items: AwarenessFeedItem[] = [];
  for (const row of vetoedRows) {
    const entityId = `intent:${row.id.id as string}`;
    // Dedup: skip if already in blocking tier
    if (blockingEntityIds.has(entityId)) continue;
    items.push(mapVetoedIntentToFeedItem(row));
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: Vetoed intents in feed awareness tier
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-3.1: 24h window filtering", () => {
  it("vetoed intents within 24h are returned by query", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const goals = rows.map((r) => r.goal);

    expect(goals).toContain("Purge cache");
    expect(goals).toContain("Delete staging env");
  });

  it("AC-3.6: vetoed intents older than 24h are excluded", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const goals = rows.map((r) => r.goal);

    expect(goals).not.toContain("Drop production table");
  });
});

describe("AC-3.2..AC-3.5: Feed item shape", () => {
  it("AC-3.2: entityKind is intent and entityName is goal", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const item = mapVetoedIntentToFeedItem(rows.find((r) => r.goal === "Purge cache")!);

    expect(item.entityKind).toBe("intent");
    expect(item.entityName).toBe("Purge cache");
  });

  it("AC-3.3: reason includes Vetoed and evaluation reason", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const item = mapVetoedIntentToFeedItem(rows.find((r) => r.goal === "Purge cache")!);

    expect(item.reason).toContain("Vetoed");
    expect(item.reason).toContain("risk exceeded budget threshold");
  });

  it("AC-3.4: status is vetoed", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const item = mapVetoedIntentToFeedItem(rows[0]!);

    expect(item.status).toBe("vetoed");
  });

  it("AC-3.5: only Discuss action offered", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const item = mapVetoedIntentToFeedItem(rows[0]!);

    expect(item.actions).toHaveLength(1);
    expect(item.actions[0].action).toBe("discuss");
    expect(item.actions[0].label).toBe("Discuss");
  });
});

describe("AC-3.7: Recency sort", () => {
  it("multiple vetoed intents sorted by most recent first", async () => {
    const rows = await listRecentlyVetoedIntents(surreal, workspaceRecord);

    // "Purge cache" (2h ago) should come before "Delete staging env" (8h ago)
    const goals = rows.map((r) => r.goal);
    const purgeIdx = goals.indexOf("Purge cache");
    const deleteIdx = goals.indexOf("Delete staging env");

    expect(purgeIdx).toBeLessThan(deleteIdx);
  });
});

describe("AC-3.8: Dedup with blocking tier", () => {
  it("pending_veto intent is excluded from awareness tier", async () => {
    const vetoedRows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const blockingIds = await listPendingVetoIntentIds(surreal, workspaceRecord);

    // Verify the pending_veto intent is in the blocking set
    const pendingId = `intent:${pendingVetoIntentRecord.id as string}`;
    expect(blockingIds.has(pendingId)).toBe(true);

    // Build awareness tier with dedup
    const awareness = buildAwarenessTier(vetoedRows, blockingIds);
    const awarenessEntityIds = awareness.map((i) => i.entityId);

    // pending_veto intent should NOT appear in awareness
    expect(awarenessEntityIds).not.toContain(pendingId);

    // vetoed intents should still appear
    expect(awareness.length).toBeGreaterThanOrEqual(2);
  });

  it("vetoed intents not in blocking tier are preserved in awareness", async () => {
    const vetoedRows = await listRecentlyVetoedIntents(surreal, workspaceRecord);
    const blockingIds = await listPendingVetoIntentIds(surreal, workspaceRecord);

    const awareness = buildAwarenessTier(vetoedRows, blockingIds);
    const names = awareness.map((i) => i.entityName);

    expect(names).toContain("Purge cache");
    expect(names).toContain("Delete staging env");
  });
});
