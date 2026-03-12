/**
 * Milestone 1: Schema Extensions and EVENT Definitions
 *
 * Traces: Story 4 (Schema Extensions), Story 6 (SurrealDB EVENT Definitions)
 *
 * Validates that:
 * - New observation fields (verified, source, data) persist correctly
 * - Extended observation_type enum accepts "validation" and "error"
 * - Extended observes edge accepts intent, git_commit, and observation as OUT
 * - SurrealQL EVENTs fire only on the correct state transitions
 * - EVENTs do NOT fire on irrelevant status changes
 * - Observer's own observations do NOT trigger the peer review EVENT (no infinite loop)
 *
 * Driving ports:
 *   Direct DB for schema validation
 *   SurrealQL EVENTs (verified via callback receipt)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createTaskWithCommit,
  triggerTaskCompletion,
  triggerIntentCompletion,
  triggerDecisionConfirmation,
  createConfirmedDecision,
  createObservationByAgent,
  createCompletedIntent,
  createGitCommit,
  waitForObservation,
  getWorkspaceObservations,
} from "./observer-test-kit";

const getRuntime = setupObserverSuite("observer_m1_schema_events");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

// =============================================================================
// Story 4: Schema Extensions
// =============================================================================

describe("Milestone 1: Schema Extensions (Story 4)", () => {
  // ---------------------------------------------------------------------------
  // S4-1: verified field persists and defaults to false
  // ---------------------------------------------------------------------------
  it("observation verified field defaults to false when not provided", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-verified");

    // When an observation is created without specifying verified
    const obsId = `obs-${crypto.randomUUID()}`;
    const obsRecord = new RecordId("observation", obsId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "Schema test observation",
        severity: "info",
        status: "open",
        source_agent: "test_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Then the verified field defaults to false
    const rows = (await surreal.query(
      `SELECT verified FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ verified: boolean }>>;

    expect(rows[0]?.[0]?.verified).toBe(false);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S4-2: source field persists as optional string
  // ---------------------------------------------------------------------------
  it("observation source field persists when provided", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-source");

    // When an observation is created with a source attribution
    const obsId = `obs-${crypto.randomUUID()}`;
    const obsRecord = new RecordId("observation", obsId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "CI status indicates build failure",
        severity: "conflict",
        status: "open",
        source_agent: "observer_agent",
        source: "github_ci",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Then the source field is persisted
    const rows = (await surreal.query(
      `SELECT source FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ source: string }>>;

    expect(rows[0]?.[0]?.source).toBe("github_ci");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S4-3: data field persists as optional object
  // ---------------------------------------------------------------------------
  it("observation data field stores raw evidence", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-data");

    // When an observation is created with raw evidence data
    const obsId = `obs-${crypto.randomUUID()}`;
    const obsRecord = new RecordId("observation", obsId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "Build passed with 94% test coverage",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        data: {
          ci_status: "success",
          test_coverage: 94.2,
          build_duration_ms: 42000,
        },
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Then the data field is persisted with its structure intact
    const rows = (await surreal.query(
      `SELECT data FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ data: Record<string, unknown> }>>;

    const data = rows[0]?.[0]?.data;
    expect(data).toBeDefined();
    expect(data!.ci_status).toBe("success");
    expect(data!.test_coverage).toBe(94.2);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S4-4: observation_type enum accepts "validation" and "error"
  // ---------------------------------------------------------------------------
  it("observation_type enum accepts validation and error values", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-type");
    const wsRecord = new RecordId("workspace", workspaceId);

    // When an observation is created with type "validation"
    const validationObsId = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", validationObsId),
      content: {
        text: "Task completion verified against CI",
        severity: "info",
        status: "open",
        observation_type: "validation",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Then the validation type is accepted
    const validationRows = (await surreal.query(
      `SELECT observation_type FROM $obs;`,
      { obs: new RecordId("observation", validationObsId) },
    )) as Array<Array<{ observation_type: string }>>;
    expect(validationRows[0]?.[0]?.observation_type).toBe("validation");

    // When an observation is created with type "error"
    const errorObsId = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", errorObsId),
      content: {
        text: "Observer failed to reach external API",
        severity: "warning",
        status: "open",
        observation_type: "error",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Then the error type is accepted
    const errorRows = (await surreal.query(
      `SELECT observation_type FROM $obs;`,
      { obs: new RecordId("observation", errorObsId) },
    )) as Array<Array<{ observation_type: string }>>;
    expect(errorRows[0]?.[0]?.observation_type).toBe("error");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S4-5: observes edge accepts intent, git_commit, observation as OUT
  // ---------------------------------------------------------------------------
  it("observes edge links observation to intent, commit, and observation targets", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an intent, commit, and another observation
    const { workspaceId, identityId } = await setupObserverWorkspace(baseUrl, surreal, "schema-observes");
    const wsRecord = new RecordId("workspace", workspaceId);

    const { intentId } = await createCompletedIntent(surreal, workspaceId, identityId, {
      goal: "Deploy feature toggle",
      reasoning: "Safe deployment",
      actionSpec: { provider: "deploy", action: "toggle" },
    });

    const { commitId } = await createGitCommit(surreal, workspaceId, `sha-${crypto.randomUUID().slice(0, 8)}`);

    const { observationId: targetObsId } = await createObservationByAgent(surreal, workspaceId, "pm_agent", {
      text: "PM agent noticed a risk",
      severity: "warning",
    });

    // When observations are linked to these extended entity types
    const obsForIntent = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obsForIntent),
      content: {
        text: "Intent completion verified",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: new RecordId("observation", obsForIntent), target: new RecordId("intent", intentId) },
    );

    const obsForCommit = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obsForCommit),
      content: {
        text: "Commit status verified",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: new RecordId("observation", obsForCommit), target: new RecordId("git_commit", commitId) },
    );

    const obsForObs = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obsForObs),
      content: {
        text: "Peer review of PM agent observation",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: new RecordId("observation", obsForObs), target: new RecordId("observation", targetObsId) },
    );

    // Then all three observes edges exist
    // SurrealDB returns nested graph traversals as nested objects: {"->observes": {"->intent": [...]}}
    const intentEdge = (await surreal.query(
      `SELECT ->observes->intent FROM $obs;`,
      { obs: new RecordId("observation", obsForIntent) },
    )) as Array<Array<Record<string, Record<string, RecordId[]>>>>;
    expect(intentEdge[0]?.[0]?.["->observes"]?.["->intent"]).toHaveLength(1);

    const commitEdge = (await surreal.query(
      `SELECT ->observes->git_commit FROM $obs;`,
      { obs: new RecordId("observation", obsForCommit) },
    )) as Array<Array<Record<string, Record<string, RecordId[]>>>>;
    expect(commitEdge[0]?.[0]?.["->observes"]?.["->git_commit"]).toHaveLength(1);

    const obsEdge = (await surreal.query(
      `SELECT ->observes->observation FROM $obs;`,
      { obs: new RecordId("observation", obsForObs) },
    )) as Array<Array<Record<string, Record<string, RecordId[]>>>>;
    expect(obsEdge[0]?.[0]?.["->observes"]?.["->observation"]).toHaveLength(1);
  }, 60_000);
});

// =============================================================================
// Story 6: SurrealDB EVENT Definitions
// =============================================================================

describe("Milestone 1: SurrealDB EVENT Definitions (Story 6)", () => {
  // ---------------------------------------------------------------------------
  // S6-1: task status -> completed fires observer webhook
  // ---------------------------------------------------------------------------
  it("task completion fires the observer event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task in progress
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-task-done");
    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Implement rate limiting",
      status: "in_progress",
    });

    // When the task status transitions to completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer receives the event and creates an observation
    const observations = await waitForObservation(surreal, "task", taskId, 15_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S6-2: task status -> in_progress does NOT fire
  // ---------------------------------------------------------------------------
  it("task transition to in_progress does not fire the observer event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task in open status
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-task-noop");
    const taskId = `task-${crypto.randomUUID()}`;
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Review PR feedback",
        status: "open",
        workspace: wsRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // When the task transitions to in_progress (not completed)
    await surreal.query(
      `UPDATE $task SET status = "in_progress", updated_at = time::now();`,
      { task: taskRecord },
    );

    // Then no observer observation is created for this task
    await Bun.sleep(3_000); // Wait to confirm no event fires
    const observations = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");
    const forThisTask = observations.filter((o) => o.text?.includes("Review PR feedback"));
    expect(forThisTask).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S6-3: intent status -> completed fires observer webhook
  // ---------------------------------------------------------------------------
  it("intent completion fires the observer event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an intent in authorized status
    const { workspaceId, identityId } = await setupObserverWorkspace(baseUrl, surreal, "event-intent-done");

    const intentId = `intent-${crypto.randomUUID()}`;
    const intentRecord = new RecordId("intent", intentId);
    const wsRecord = new RecordId("workspace", workspaceId);
    const requesterRecord = new RecordId("identity", identityId);
    const traceRecord = new RecordId("trace", `trace-${intentId}`);

    await surreal.query(`CREATE $trace CONTENT $content;`, {
      trace: traceRecord,
      content: { type: "intent_submission", actor: requesterRecord, workspace: wsRecord, created_at: new Date() },
    });

    await surreal.query(`CREATE $intent CONTENT $content;`, {
      intent: intentRecord,
      content: {
        goal: "Deploy feature toggle",
        reasoning: "Safe deployment of new feature",
        status: "authorized",
        priority: 50,
        action_spec: { provider: "deploy", action: "toggle" },
        trace_id: traceRecord,
        requester: requesterRecord,
        workspace: wsRecord,
        evaluation: { decision: "APPROVE", risk_score: 10, reason: "Low risk", evaluated_at: new Date(), policy_only: false },
        created_at: new Date(),
      },
    });

    // When the intent transitions to completed
    await triggerIntentCompletion(surreal, intentId, "completed");

    // Then the observer receives the event and creates an observation
    const observations = await waitForObservation(surreal, "intent", intentId, 15_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S6-4: commit creation fires observer webhook
  // ---------------------------------------------------------------------------
  it("new git commit fires the observer event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-commit");
    const sha = `sha-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    // When a new git_commit record is created (triggers commit_created EVENT)
    const { commitId } = await createGitCommit(surreal, workspaceId, sha, {
      message: "feat: add rate limiting middleware",
      repository: "org/brain",
    });

    // Then the observer receives the event and creates an observation
    const observations = await waitForObservation(surreal, "git_commit", commitId, 15_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S6-5: decision confirmed fires observer webhook
  // ---------------------------------------------------------------------------
  it("decision confirmation fires the observer event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a proposed decision
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-decision");

    const decisionId = `dec-${crypto.randomUUID()}`;
    const decisionRecord = new RecordId("decision", decisionId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $dec CONTENT $content;`, {
      dec: decisionRecord,
      content: {
        summary: "Use tRPC for all new API endpoints",
        rationale: "Consistency and type safety",
        status: "proposed",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // When the decision is confirmed
    await triggerDecisionConfirmation(surreal, decisionId, "confirmed");

    // Then the observer receives the event and creates an observation
    const observations = await waitForObservation(surreal, "decision", decisionId, 15_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S6-6: observation by pm_agent fires peer review webhook
  // ---------------------------------------------------------------------------
  it("observation from another agent fires the peer review event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-peer");

    // When the PM agent creates an observation
    const { observationId } = await createObservationByAgent(surreal, workspaceId, "pm_agent", {
      text: "Task priority may be too low for the approaching deadline",
      severity: "warning",
      observationType: "anomaly",
    });

    // Then the observer receives the peer review event
    // and creates its own observation linked to the PM agent's observation
    const observations = await waitForObservation(surreal, "observation", observationId, 15_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S6-7: observation by observer_agent does NOT fire peer review (no loop)
  // ---------------------------------------------------------------------------
  it("observer's own observations do not trigger the peer review event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "event-noloop");

    // When the observer agent creates an observation
    await createObservationByAgent(surreal, workspaceId, "observer_agent", {
      text: "Verification passed for task completion",
      severity: "info",
      observationType: "validation",
    });

    // Then no additional peer review observation is created (no infinite loop)
    await Bun.sleep(3_000); // Wait to confirm no recursive event fires
    const observerObs = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");
    // Only the one we created -- no additional peer review observation
    expect(observerObs).toHaveLength(1);
  }, 30_000);
});
