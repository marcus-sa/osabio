/**
 * Acceptance Tests: Reverse Coherence Scan (ADR-051)
 *
 * Traces: Intelligence Capability -- Reverse Coherence Scan
 * Driving port: POST /api/workspaces/:workspaceId/observer/scan
 *
 * Validates that the Observer's batch coherence scan detects completed tasks
 * that have no linked decision records, creating
 * "implementation without decision" observations.
 *
 * This is the reverse of the existing orphaned decision check (which finds
 * decisions without implementations).
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  seedCompletedTaskWithoutDecision,
  seedConfirmedDecision,
  triggerCoherenceScan,
  getObservationsForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_observer_coherence");

// ---------------------------------------------------------------------------
// Walking Skeleton: Completed task without decision link flagged
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Implementation without recorded decision detected", () => {
  it("creates an observation for a completed task that has no linked decision record", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-coh-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a completed task with no linked decision (completed 15+ days ago)
    await seedCompletedTaskWithoutDecision(surreal, `task-orphan-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Implement Redis caching for session store",
      completedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000), // 16 days ago
    });

    // When the Observer coherence scan runs
    const scanResponse = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scanResponse.status).toBe(200);

    // Then an "implementation without decision" observation is created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const implObs = observations.filter(o => o.text.includes("without"));
    expect(implObs.length).toBeGreaterThanOrEqual(1);
    expect(implObs[0].severity).toBe("info");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Completed task WITH decision link -- no observation", () => {
  it("does not flag a completed task that has a linked decision record", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-coh-linked-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const taskId = `task-linked-${crypto.randomUUID()}`;
    const decisionId = `dec-linked-${crypto.randomUUID()}`;

    // Given a completed task that IS linked to a decision
    await seedCompletedTaskWithoutDecision(surreal, taskId, {
      workspaceId,
      title: "Implement tRPC billing endpoint",
      completedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
    });
    await seedConfirmedDecision(surreal, decisionId, {
      workspaceId,
      summary: "Use tRPC for all internal APIs",
    });

    // Link the decision to the task via implemented_by edge
    // Schema: implemented_by IN decision|task OUT git_commit|pull_request
    // But for task-decision link we use belongs_to (task->belongs_to->feature<-belongs_to<-decision)
    // or direct: RELATE decision->implemented_by->... won't work for tasks.
    // The acceptance criteria says: tasks WITH decision links (direct or via feature->belongs_to->decision)
    // Simplest: create a feature, link both task and decision to it
    const featureId = `feat-linked-${crypto.randomUUID()}`;
    const featureRecord = new RecordId("feature", featureId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $feat CONTENT $content;`, {
      feat: featureRecord,
      content: {
        name: "Billing Feature",
        status: "active",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Link task to feature and decision to feature via belongs_to
    const taskRecord = new RecordId("task", taskId);
    const decisionRecord = new RecordId("decision", decisionId);
    await surreal.query(
      `RELATE $task->belongs_to->$feat SET added_at = time::now();`,
      { task: taskRecord, feat: featureRecord },
    );
    await surreal.query(
      `RELATE $dec->belongs_to->$feat SET added_at = time::now();`,
      { dec: decisionRecord, feat: featureRecord },
    );

    // When the coherence scan runs
    const scanResponse = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scanResponse.status).toBe(200);

    // Then no "implementation without decision" observation is created for this task
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const matchingObs = observations.filter(o =>
      o.text.includes("tRPC billing") && o.text.includes("without"),
    );
    expect(matchingObs.length).toBe(0);
  }, 30_000);
});

describe("Recent task (under age threshold) -- not flagged", () => {
  it("does not flag recently completed tasks that are under the 14-day age threshold", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-coh-recent-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a task completed only 5 days ago (under 14-day threshold)
    await seedCompletedTaskWithoutDecision(surreal, `task-recent-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Set up monitoring dashboard",
      completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    });

    // When the coherence scan runs
    const scanResponse = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scanResponse.status).toBe(200);

    // Then no observation is created (task is too recent)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const matchingObs = observations.filter(o => o.text.includes("monitoring"));
    expect(matchingObs.length).toBe(0);
  }, 30_000);
});

describe("Multiple implementations without decisions -- separate observations", () => {
  it("creates separate observations for each implementation without a decision link", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-coh-multi-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given multiple completed tasks without decision links
    await seedCompletedTaskWithoutDecision(surreal, `task-multi1-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Implement Redis caching",
      completedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    });
    await seedCompletedTaskWithoutDecision(surreal, `task-multi2-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Add MongoDB integration",
      completedAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
    });
    await seedCompletedTaskWithoutDecision(surreal, `task-multi3-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Set up GraphQL gateway",
      completedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
    });

    // When the coherence scan runs
    const scanResponse = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scanResponse.status).toBe(200);

    // Then separate observations exist for each unlinked implementation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const implObs = observations.filter(o => o.text.includes("without"));
    expect(implObs.length).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe("Duplicate scan -- no duplicate observations created", () => {
  it("does not create duplicate observations when the coherence scan runs twice", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-coh-dedup-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a completed task without decision link
    await seedCompletedTaskWithoutDecision(surreal, `task-dedup-${crypto.randomUUID()}`, {
      workspaceId,
      title: "Implement Elasticsearch integration",
      completedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    });

    // When the coherence scan runs twice
    const scan1 = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scan1.status).toBe(200);

    const scan2 = await triggerCoherenceScan(baseUrl, workspaceId);
    expect(scan2.status).toBe(200);

    // Then only one observation exists (deduplication prevents duplicates)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    const matchingObs = observations.filter(o => o.text.includes("Elasticsearch"));
    expect(matchingObs.length).toBe(1);
  }, 45_000);
});
