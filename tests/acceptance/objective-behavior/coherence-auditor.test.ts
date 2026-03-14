/**
 * Coherence Auditor Acceptance Tests (US-OB-06)
 *
 * Validates that the coherence auditor detects disconnected graph patterns:
 * - Orphaned decisions: confirmed, 14d+ old, no implementing task/commit
 * - Stale objectives: active, 14d+ old, no supports edges
 * - Connected objectives not flagged
 * - Recently created decisions not flagged
 *
 * Driving ports:
 *   runCoherenceScans()  (coherence audit function from graph-scan)
 *   SurrealDB direct queries (verification of observations)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObjectiveBehaviorSuite,
  setupObjectiveWorkspace,
  createObjective,
  createDecision,
  createIntent,
  createSupportsEdge,
  getWorkspaceObservations,
} from "./objective-behavior-test-kit";
import {
  runCoherenceScans,
  queryOrphanedDecisions,
  queryStaleObjectives,
} from "../../../app/src/server/observer/graph-scan";

const getRuntime = setupObjectiveBehaviorSuite("coherence_auditor");

// =============================================================================
// US-OB-06 #1: Orphaned decision detected and observation created
// =============================================================================
describe("US-OB-06 #1: Orphaned decision detection", () => {
  it("orphaned decision (confirmed, 14d+ old, no implementing task) detected and observation created", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-orphan-${crypto.randomUUID()}`,
    );

    // Given a confirmed decision created 27 days ago
    const pastDate = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000);
    await createDecision(surreal, workspaceId, {
      summary: "Standardize on tRPC",
      status: "confirmed",
      created_at: pastDate,
    });

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When the coherence auditor runs
    const result = await runCoherenceScans(surreal, workspaceRecord);

    // Then an orphaned decision is detected
    expect(result.orphaned_decisions_found).toBeGreaterThanOrEqual(1);
    expect(result.observations_created).toBeGreaterThanOrEqual(1);

    // And an observation is created for the orphaned decision
    const observations = await getWorkspaceObservations(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const orphanObs = observations.filter((o) =>
      o.text.includes("Standardize on tRPC"),
    );
    expect(orphanObs.length).toBeGreaterThanOrEqual(1);
    expect(orphanObs[0].severity).toBe("warning");
  }, 60_000);
});

// =============================================================================
// US-OB-06 #2: Stale objective detected and observation created
// =============================================================================
describe("US-OB-06 #2: Stale objective detection", () => {
  it("stale objective (active, 14d+ old, no supports edges) detected and observation created", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-stale-${crypto.randomUUID()}`,
    );

    // Given an active objective created 20 days ago with no supports edges
    const pastDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    // Create objective with backdated created_at
    const objectiveId = `obj-${crypto.randomUUID()}`;
    const objectiveRecord = new RecordId("objective", objectiveId);
    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $objective CONTENT $content;`, {
      objective: objectiveRecord,
      content: {
        title: "Improve Infrastructure Reliability",
        description: "Improve Infrastructure Reliability",
        status: "active",
        priority: "high",
        success_criteria: [],
        workspace: workspaceRecord,
        created_at: pastDate,
        updated_at: pastDate,
      },
    });

    // When the coherence auditor runs
    const result = await runCoherenceScans(surreal, workspaceRecord);

    // Then a stale objective is detected
    expect(result.stale_objectives_found).toBeGreaterThanOrEqual(1);
    expect(result.observations_created).toBeGreaterThanOrEqual(1);

    // And an observation is created for the stale objective
    const observations = await getWorkspaceObservations(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const staleObs = observations.filter((o) =>
      o.text.includes("Improve Infrastructure Reliability"),
    );
    expect(staleObs.length).toBeGreaterThanOrEqual(1);
    expect(staleObs[0].severity).toBe("warning");
  }, 60_000);
});

// =============================================================================
// US-OB-06 #3: Connected objective with supports edges not flagged
// =============================================================================
describe("US-OB-06 #3: Connected objective not flagged as stale", () => {
  it("connected objective with supports edges is not flagged as stale", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, identityId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-connected-${crypto.randomUUID()}`,
    );

    // Given an old active objective
    const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const objectiveId = `obj-${crypto.randomUUID()}`;
    const objectiveRecord = new RecordId("objective", objectiveId);
    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $objective CONTENT $content;`, {
      objective: objectiveRecord,
      content: {
        title: "Launch MCP Marketplace",
        description: "Launch MCP Marketplace",
        status: "active",
        priority: "high",
        success_criteria: [],
        workspace: workspaceRecord,
        created_at: pastDate,
        updated_at: pastDate,
      },
    });

    // And it has a supporting intent
    const { intentId } = await createIntent(surreal, workspaceId, identityId, {
      goal: "Build MCP integration page",
    });
    await createSupportsEdge(surreal, intentId, objectiveId, {
      alignment_score: 0.85,
    });

    // When the coherence auditor runs
    const result = await runCoherenceScans(surreal, workspaceRecord);

    // Then no stale objectives are detected (only orphaned decisions may be found)
    expect(result.stale_objectives_found).toBe(0);

    // And no observation is created about this objective
    const observations = await getWorkspaceObservations(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const marketplaceObs = observations.filter((o) =>
      o.text.includes("Launch MCP Marketplace"),
    );
    expect(marketplaceObs).toHaveLength(0);
  }, 60_000);
});

// =============================================================================
// US-OB-06 #5: Recently created decision not flagged as orphan
// =============================================================================
describe("US-OB-06 #5: Recently created decision not flagged", () => {
  it("decision created within threshold period is not considered orphaned", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-recent-${crypto.randomUUID()}`,
    );

    // Given a confirmed decision created just now (within 14-day threshold)
    await createDecision(surreal, workspaceId, {
      summary: "Use WebSocket for real-time updates",
      status: "confirmed",
      created_at: new Date(),
    });

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When the coherence auditor runs
    const result = await runCoherenceScans(surreal, workspaceRecord);

    // Then no orphaned decisions are found
    expect(result.orphaned_decisions_found).toBe(0);

    // And no observation is created about this decision
    const observations = await getWorkspaceObservations(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const wsObs = observations.filter((o) =>
      o.text.includes("WebSocket"),
    );
    expect(wsObs).toHaveLength(0);
  }, 60_000);
});
