/**
 * Regression test: deduplicated anomalies must not leak into pattern synthesis.
 *
 * Before this fix, runGraphScan would skip creating duplicate anomaly observations
 * (entity-level dedup worked correctly) but still pass those anomalies to
 * synthesizePatterns(). The LLM would then create a "pattern" observation from
 * already-known anomalies, producing an unexpected extra observation.
 *
 * Uses mock.module to stub SurrealDB + observation queries so this runs as a
 * pure unit test with no external dependencies.
 */
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";
import type { Anomaly } from "../../../app/src/server/observer/llm-synthesis";
import type { GraphScanLlm } from "../../../app/src/server/observer/graph-scan";

// ---------------------------------------------------------------------------
// Stubs: capture what synthesizePatterns receives
// ---------------------------------------------------------------------------

let capturedSynthesisAnomalies: Anomaly[] | undefined;

const stubLlm: GraphScanLlm = {
  detectContradictions: async () => [],
  evaluateAnomalies: async (_model, candidates) =>
    candidates.map((c) => ({
      entity_ref: c.entityRef,
      relevant: true,
      reasoning: "stub: relevant",
      suggested_severity: "warning" as const,
    })),
  synthesizePatterns: async (_model, anomalies) => {
    capturedSynthesisAnomalies = anomalies;
    return [];
  },
};

// ---------------------------------------------------------------------------
// Mock SurrealDB query responses
// ---------------------------------------------------------------------------

const TASK_ID = "task-dedup-regression-001";
const WS_RECORD = new RecordId("workspace", "ws-dedup-001");
const TASK_RECORD = new RecordId("task", TASK_ID);

const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

// Dispatch query responses by matching a unique substring in the SQL
const queryDispatch: Array<{ match: string; response: unknown[] }> = [
  // queryStaleBlockedTasks — must be before queryCompletedTasks (both start with same prefix)
  { match: 'status = "blocked"', response: [
    { id: TASK_RECORD, title: "Stale task for dedup regression", updated_at: fifteenDaysAgo.toISOString() },
  ]},
  // queryCompletedTasks
  { match: 'status IN ["completed", "done"]', response: [] },
  // queryConfirmedDecisions
  { match: "FROM decision", response: [] },
  // queryStatusDriftTasks
  { match: "->depends_on->task", response: [] },
  // queryOrphanedDecisions (also FROM decision but with implemented_by)
  { match: "implemented_by", response: [] },
  // queryStaleObjectives
  { match: "FROM objective", response: [] },
  // queryExistingObserverObservationsForEntity — returns existing observation (triggers dedup)
  { match: 'source_agent = "observer_agent"', response: [
    { text: "Task blocked for over 14 days: Stale task for dedup regression", severity: "warning", status: "open" },
  ]},
];

const mockSurreal = {
  query: mock(async (sql: string, _bindings?: unknown) => {
    for (const entry of queryDispatch) {
      if (sql.includes(entry.match)) return [entry.response];
    }
    return [[]];
  }),
};

// Mock observation queries module
mock.module("../../../app/src/server/observation/queries", () => ({
  createObservation: mock(async () => undefined),
  listWorkspaceOpenObservations: mock(async () => []),
}));

// Mock learning-diagnosis module
mock.module("../../../app/src/server/observer/learning-diagnosis", () => ({
  runDiagnosticClustering: mock(async () => ({
    result: { clusters_found: 0, coverage_skips: 0, learning_proposals_created: 0 },
    uncoveredClusters: [],
  })),
  queryWorkspaceBehaviorTrends: mock(async () => []),
  proposeBehaviorLearning: mock(async () => ({ created: false })),
  checkBehaviorLearningRateLimit: mock(async () => ({ blocked: false, count: 0 })),
}));

// Import after mocks are set up
const { runGraphScan } = await import("../../../app/src/server/observer/graph-scan");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph scan dedup → synthesis filtering", () => {
  beforeEach(() => {
    capturedSynthesisAnomalies = undefined;
  });

  it("does not pass deduplicated stale-blocked anomalies to synthesizePatterns", async () => {
    const result = await runGraphScan(
      mockSurreal as never,
      WS_RECORD,
      {} as never,
      stubLlm,
    );

    // Stale blocked task was detected
    expect(result.stale_blocked_found).toBe(1);

    // No duplicate observation created (entity-level dedup caught it)
    expect(result.observations_created).toBe(0);

    // The deduplicated anomaly was NOT leaked to synthesizePatterns
    const leaked = (capturedSynthesisAnomalies ?? []).filter(
      (a) => a.type === "stale_blocked" && a.entityId === TASK_ID,
    );
    expect(leaked).toHaveLength(0);
  });
});
