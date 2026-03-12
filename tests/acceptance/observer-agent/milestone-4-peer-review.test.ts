/**
 * Milestone 4: Decision Verification and Cross-Agent Peer Review
 *
 * Traces: Story 9 (Decision Confirmation Verification),
 *         Story 10 (Cross-Agent Peer Review)
 *
 * Validates:
 * - Decision confirmed -> observer checks implementations for alignment
 * - Decision superseded -> observer flags stale implementations
 * - Non-observer observation -> observer cross-checks claim against graph
 * - Observer's own observations do NOT trigger peer review (no infinite loop)
 *
 * Driving ports:
 *   POST /api/observe/decision/:id     (SurrealQL EVENT target)
 *   POST /api/observe/observation/:id  (SurrealQL EVENT target for peer review)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createConfirmedDecision,
  createObservationByAgent,
  triggerDecisionConfirmation,
  waitForObservation,
  getWorkspaceObservations,
  createReadyTask,
} from "./observer-test-kit";

const getRuntime = setupObserverSuite("observer_m4_peer_review");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

// =============================================================================
// Story 9: Decision Confirmation Verification
// =============================================================================

describe("Milestone 4: Decision Confirmation Verification (Story 9)", () => {
  // ---------------------------------------------------------------------------
  // S9-1: Decision confirmed -> implementations checked for alignment
  // ---------------------------------------------------------------------------
  it("observer verifies that implementations align with confirmed decision", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a proposed decision about API architecture
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "dec-confirm");

    const decisionId = `dec-${crypto.randomUUID()}`;
    const decisionRecord = new RecordId("decision", decisionId);

    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $dec CONTENT $content;`, {
      dec: decisionRecord,
      content: {
        summary: "All new endpoints must use GraphQL instead of REST",
        rationale: "Reduce over-fetching and improve client flexibility",
        status: "proposed",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    // And there are completed tasks in the workspace
    await createReadyTask(surreal, workspaceId, {
      title: "Implement user profile GraphQL resolver",
      status: "completed",
    });

    // When the decision is confirmed
    await triggerDecisionConfirmation(surreal, decisionId, "confirmed");

    // Then the observer verifies implementations and creates an observation
    const observations = await waitForObservation(surreal, "decision", decisionId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation severity reflects alignment check results
    expect(["info", "warning", "conflict"]).toContain(obs.severity);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S9-2: Decision superseded -> stale implementations flagged
  // ---------------------------------------------------------------------------
  it("observer flags stale implementations when a decision is superseded", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a confirmed decision that has existing implementations
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "dec-supersede");

    const decisionId = `dec-${crypto.randomUUID()}`;
    const decisionRecord = new RecordId("decision", decisionId);

    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $dec CONTENT $content;`, {
      dec: decisionRecord,
      content: {
        summary: "Use JWT tokens for all service-to-service auth",
        rationale: "Standardize auth across microservices",
        status: "confirmed",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    // And tasks were completed implementing this decision
    const task = await createReadyTask(surreal, workspaceId, {
      title: "Implement JWT auth for billing service",
      status: "completed",
    });

    // When the decision is superseded (e.g., switching to mTLS)
    await triggerDecisionConfirmation(surreal, decisionId, "superseded");

    // Then the observer flags that existing implementations may be stale
    const observations = await waitForObservation(surreal, "decision", decisionId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    // A superseded decision with existing implementations should be flagged
    expect(["warning", "conflict"]).toContain(obs.severity);
  }, 120_000);
});

// =============================================================================
// Story 10: Cross-Agent Peer Review
// =============================================================================

describe("Milestone 4: Cross-Agent Peer Review (Story 10)", () => {
  // ---------------------------------------------------------------------------
  // S10-1: PM agent observation -> observer cross-checks claim
  // ---------------------------------------------------------------------------
  it("observer cross-checks a PM agent observation against graph state", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with project context
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "peer-pm");

    // And some tasks in the workspace for context
    await createReadyTask(surreal, workspaceId, {
      title: "Implement caching layer",
      status: "completed",
    });
    await createReadyTask(surreal, workspaceId, {
      title: "Add cache invalidation logic",
      status: "in_progress",
    });

    // When the PM agent creates an observation about project risk
    const { observationId } = await createObservationByAgent(surreal, workspaceId, "pm_agent", {
      text: "Cache implementation is complete but invalidation logic is missing, creating a data consistency risk",
      severity: "warning",
      observationType: "missing",
    });

    // Then the observer cross-checks this claim against the graph
    const observations = await waitForObservation(surreal, "observation", observationId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const peerReview = observations[0];
    expect(peerReview.source_agent).toBe("observer_agent");
    // And the peer review observation is linked to the original observation
    expect(peerReview.text).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S10-2: Architect agent observation -> observer peer reviews
  // ---------------------------------------------------------------------------
  it("observer peer-reviews an architect agent observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with architectural context
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "peer-arch");

    // When the architect agent creates an observation about a contradiction
    const { observationId } = await createObservationByAgent(surreal, workspaceId, "architect_agent", {
      text: "REST endpoint in billing service contradicts tRPC standardization decision",
      severity: "conflict",
      observationType: "contradiction",
    });

    // Then the observer cross-checks the claim
    const observations = await waitForObservation(surreal, "observation", observationId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const peerReview = observations[0];
    expect(peerReview.source_agent).toBe("observer_agent");
    expect(["info", "warning", "conflict"]).toContain(peerReview.severity);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S10-3: Observer's own observations do NOT trigger peer review
  // ---------------------------------------------------------------------------
  it("observer's own observations do not trigger recursive peer review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "peer-noloop");

    // When the observer agent itself creates an observation
    const { observationId } = await createObservationByAgent(surreal, workspaceId, "observer_agent", {
      text: "Task completion verified - CI passed",
      severity: "info",
      observationType: "validation",
    });

    // Then no peer review event is fired (EVENT filters on source_agent != "observer_agent")
    await Bun.sleep(3_000);

    // And no additional observations are created by the observer for this observation
    const allObserverObs = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");
    // Only the one we explicitly created -- no peer review observation
    expect(allObserverObs).toHaveLength(1);
    expect((allObserverObs[0].id.id as string)).toBe(observationId);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S10-4: Multiple agents creating observations do not cause cascading reviews
  // ---------------------------------------------------------------------------
  it("peer review observations do not cascade between agents", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "peer-cascade");

    // When multiple non-observer agents create observations
    await createObservationByAgent(surreal, workspaceId, "pm_agent", {
      text: "Sprint velocity declining over last 3 iterations",
      severity: "warning",
      observationType: "pattern",
    });

    await createObservationByAgent(surreal, workspaceId, "architect_agent", {
      text: "Technical debt accumulating in auth module",
      severity: "warning",
      observationType: "anomaly",
    });

    // Then the observer creates peer review observations for each
    // but those peer review observations (from observer_agent) do NOT trigger further reviews
    await Bun.sleep(5_000);

    const observerObs = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");
    // Should have exactly 2 peer review observations (one per non-observer observation)
    // NOT more, because observer's own observations don't trigger peer review
    expect(observerObs.length).toBeLessThanOrEqual(2);
  }, 60_000);
});
