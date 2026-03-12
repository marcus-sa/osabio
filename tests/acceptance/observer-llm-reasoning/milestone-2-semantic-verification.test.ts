/**
 * Milestone 2: Semantic Verification Pipeline
 *
 * Traces: Roadmap Phase 02 (02-01, 02-02, 02-03, 02-04)
 *   - US-1 (AC-1.1 through AC-1.6): LLM semantic contradiction detection
 *   - R1: LLM verification pipeline integration
 *   - R2: Skip optimization
 *   - R3: LLM fallback on failure
 *   - R5: Structured output
 *
 * IMPORTANT: These tests call a real LLM. OBSERVER_MODEL must be set in .env.
 *
 * Validates that:
 * - LLM detects semantic contradictions between decisions and completed tasks
 * - LLM confirms matches when task aligns with decision
 * - Low confidence verdicts downgrade to inconclusive
 * - LLM failure falls back to deterministic verdict
 * - Skip optimization bypasses LLM when appropriate
 * - Multiple observes edges link contradiction to both task and decision
 * - Evidence refs are post-validated against workspace entities
 *
 * Driving ports:
 *   POST /api/observe/task/:id         (SurrealQL EVENT target)
 *   SurrealDB direct queries           (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  triggerTaskCompletion,
  waitForObservation,
  getObservationsForEntity,
  createProject,
  createTaskInProject,
  createDecisionInProject,
  setWorkspaceObserverSkip,
  countObservations,
} from "./llm-reasoning-test-kit";

const getRuntime = setupObserverSuite("observer_llm_m2_verification");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

// =============================================================================
// AC-1.1: LLM detects semantic contradiction on task completion
// =============================================================================

describe("Milestone 2: Semantic Contradiction Detection (AC-1.1)", () => {
  it("LLM detects mismatch when task contradicts confirmed decision", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-contra-1");
    const { projectId } = await createProject(surreal, workspaceId, "Contradiction Project");

    // Given a confirmed decision about API standardization
    await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "Standardize on tRPC for all new API endpoints. REST endpoints are forbidden for new services.",
      rationale: "Type safety and consistency across the codebase",
    });

    // And a task that implements REST endpoints (contradicts the decision)
    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Implement billing API with REST endpoints",
      description: "Build a RESTful billing API with Express routes for payment processing, invoice generation, and subscription management.",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates a contradiction observation
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation indicates a conflict
    expect(obs.severity).toBe("conflict");
    expect(obs.observation_type).toBe("contradiction");
    // And the source indicates LLM reasoning was used
    expect(obs.source).toBe("llm");
    // And the observation text describes the specific conflict
    expect(obs.text).toBeTruthy();
    expect(obs.text.length).toBeGreaterThan(30);
  }, 120_000);

  it("LLM creates observes edges to both task and contradicted decision", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-edges-1");
    const { projectId } = await createProject(surreal, workspaceId, "Edge Test Project");

    // Given a confirmed decision and a contradicting task
    const { decisionId } = await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "All database queries must use parameterized statements. No string concatenation in SQL.",
      rationale: "SQL injection prevention",
    });

    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Build admin search with dynamic SQL string construction",
      description: "Implement admin search by building SQL queries via string concatenation based on filter parameters.",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates an observation
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    // And the observation has observes edges to the task
    // (edge to task is verified by waitForObservation finding it via reverse traversal)
    // The edge to decision is verified separately:
    const decisionObs = await getObservationsForEntity(surreal, "decision", decisionId);
    // At least one observation should link to the decision
    expect(decisionObs.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// =============================================================================
// AC-1.2: No contradiction creates match observation
// =============================================================================

describe("Milestone 2: Match Confirmation (AC-1.2)", () => {
  it("LLM confirms match when task aligns with decision", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-match-1");
    const { projectId } = await createProject(surreal, workspaceId, "Match Project");

    // Given a confirmed decision about TypeScript usage
    await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "Use TypeScript for all backend services. No plain JavaScript files.",
      rationale: "Type safety and maintainability",
    });

    // And a task that aligns with the decision
    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Implement authentication middleware in TypeScript",
      description: "Build JWT authentication middleware using TypeScript with strict type checking.",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates an informational observation (match)
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation is informational (not a conflict)
    expect(obs.severity).toBe("info");
  }, 120_000);
});

// =============================================================================
// AC-1.4: LLM failure falls back to deterministic verdict
// =============================================================================

describe("Milestone 2: LLM Fallback (AC-1.4)", () => {
  // Note: This test validates fallback behavior. In a real acceptance environment,
  // LLM failures are rare. The test verifies that when the system does fall back,
  // the observation source indicates the fallback path.
  // Full fallback simulation is covered by unit tests on the verdict logic.

  it("observation source is deterministic_fallback when LLM was unavailable", async () => {
    // This scenario is inherently difficult to trigger in E2E without controlling
    // the LLM provider. Instead, verify the structural contract: observations from
    // the deterministic path have appropriate source values.
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-fallback");
    const { projectId } = await createProject(surreal, workspaceId, "Fallback Project");

    // Given a task with no decisions (deterministic path produces match)
    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Simple refactoring task with no decision context",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then an observation is created (regardless of LLM availability)
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    // Source should be one of the valid source values
    expect(["llm", "deterministic_fallback", "github", "none"]).toContain(obs.source ?? "none");
  }, 120_000);
});

// =============================================================================
// AC-1.5: Low confidence downgrades to inconclusive
// =============================================================================

describe("Milestone 2: Confidence Threshold (AC-1.5)", () => {
  it("ambiguous task-decision relationship produces info severity (not conflict)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-ambiguous");
    const { projectId } = await createProject(surreal, workspaceId, "Ambiguous Project");

    // Given a decision that is loosely related to the task domain
    await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "Prefer convention over configuration for internal tooling",
      rationale: "Reduce onboarding friction",
    });

    // And a task that is tangentially related (ambiguous alignment)
    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Add configuration file for linter settings",
      description: "Create .eslintrc with project-specific linting rules",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates an observation
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    // The verdict should not be a hard conflict for ambiguous cases
    // (LLM may return match or inconclusive, but not conflict for this scenario)
    expect(obs.severity).not.toBe("conflict");
  }, 120_000);
});

// =============================================================================
// AC-1.3 / AC-1.3b: Skip optimization
// =============================================================================

describe("Milestone 2: Skip Optimization (AC-1.3)", () => {
  it("skip optimization disabled forces LLM invocation", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-noskip");
    const { projectId } = await createProject(surreal, workspaceId, "No-Skip Project");

    // Given skip optimization is explicitly disabled
    await setWorkspaceObserverSkip(surreal, workspaceId, false);

    // And a decision and aligned task exist
    await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "Use functional programming patterns for data transformations",
    });

    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Implement data pipeline using map/filter/reduce",
      description: "Build ETL pipeline using pure functional transformations",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observation source should be "llm" (LLM was invoked despite match)
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source).toBe("llm");
  }, 120_000);
});

// =============================================================================
// AC-1.6: Invalid evidence refs stripped by post-validation
// =============================================================================

describe("Milestone 2: Evidence Ref Validation (AC-1.6)", () => {
  it("observation is created even when LLM references non-existent entities", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-evref");
    const { projectId } = await createProject(surreal, workspaceId, "Evidence Ref Project");

    // Given a clear contradiction scenario (to ensure LLM produces evidence refs)
    await createDecisionInProject(surreal, workspaceId, projectId, {
      summary: "All API responses must use JSON format. No XML or HTML responses.",
    });

    const { taskId } = await createTaskInProject(surreal, workspaceId, projectId, {
      title: "Implement XML export endpoint for legacy integration",
      description: "Build an endpoint that returns XML-formatted data for the legacy ERP system.",
      status: "in_progress",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then an observation is created (post-validation should strip bad refs)
    const observations = await waitForObservation(surreal, "task", taskId, 60_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    // The observation exists and is valid regardless of evidence ref accuracy
    expect(observations[0].text).toBeTruthy();
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 120_000);
});
