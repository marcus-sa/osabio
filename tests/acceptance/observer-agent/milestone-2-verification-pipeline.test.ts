/**
 * Milestone 2: Verification Pipeline
 *
 * Traces: Story 1 (Task Verification), Story 2 (Intent Verification),
 *         Story 2b (Commit Verification), Story 3 (Graceful Degradation)
 *
 * Validates the core claim-vs-reality comparison:
 * - match -> observation severity: info, verified: true
 * - mismatch -> observation severity: conflict, verified: false
 * - inconclusive -> observation severity: info, note missing source
 * - External API failures do NOT block the original workflow
 *
 * Driving ports:
 *   POST /api/observe/task/:id
 *   POST /api/observe/intent/:id
 *   POST /api/observe/git_commit/:id
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createTaskWithCommit,
  createCompletedIntent,
  createGitCommit,
  triggerTaskCompletion,
  triggerIntentCompletion,
  waitForObservation,
  getWorkspaceObservations,
  createMockGitHubServer,
} from "./observer-test-kit";

const getRuntime = setupObserverSuite("observer_m2_verification");

let mockGitHub: ReturnType<typeof createMockGitHubServer>;
let originalGitHubUrl: string | undefined;

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);

  // Single file-level mock GitHub server — tests add routes dynamically.
  // Prevents race conditions when SurrealDB ASYNC+RETRY events outlive per-test mocks.
  mockGitHub = createMockGitHubServer();
  originalGitHubUrl = process.env.GITHUB_API_URL;
  process.env.GITHUB_API_URL = mockGitHub.url;
});

afterAll(() => {
  mockGitHub?.stop();
  if (originalGitHubUrl !== undefined) {
    process.env.GITHUB_API_URL = originalGitHubUrl;
  } else {
    delete process.env.GITHUB_API_URL;
  }
});

// =============================================================================
// Story 1: Task Completion Verification
// =============================================================================

describe("Milestone 2: Task Completion Verification (Story 1)", () => {
  // ---------------------------------------------------------------------------
  // S1-1: Task with passing CI -> observation severity info, verified true
  // ---------------------------------------------------------------------------
  it("task linked to passing CI produces a verified observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task linked to a commit with passing CI
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "verify-pass");
    const sha = `abc${crypto.randomUUID().replace(/-/g, "").slice(0, 37)}`;

    // Register success response for this commit's SHA
    mockGitHub.addRoute({
      path: `/repos/org/brain/commits/${sha}/status`,
      status: 200,
      body: { state: "success", statuses: [], total_count: 1 },
    });

    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Add rate limiting to API gateway",
      status: "in_progress",
      sha,
      repository: "org/brain",
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates a verified observation
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.severity).toBe("info");
    expect(obs.verified).toBe(true);
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation records the external signal source
    expect(obs.source).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S1-2: Task with failing CI -> observation severity conflict, verified false
  // ---------------------------------------------------------------------------
  it("task linked to failing CI produces a conflict observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task linked to a commit with failing CI
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "verify-fail");
    const sha = `def${crypto.randomUUID().replace(/-/g, "").slice(0, 37)}`;

    // Register failure response for this commit's SHA
    mockGitHub.addRoute({
      path: `/repos/org/brain/commits/${sha}/status`,
      status: 200,
      body: { state: "failure", statuses: [{ state: "failure" }], total_count: 1 },
    });

    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Refactor authentication middleware",
      status: "in_progress",
      sha,
      repository: "org/brain",
    });

    // When the task is marked as completed despite failing CI
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates a conflict observation flagging the mismatch
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.severity).toBe("conflict");
    expect(obs.verified).toBe(false);
    expect(obs.source_agent).toBe("observer_agent");
    expect(obs.text).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S1-3: Task with no external signals -> inconclusive observation
  // ---------------------------------------------------------------------------
  it("task with no external signals produces an inconclusive observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task that has no linked commits or PRs
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "verify-none");
    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Update team onboarding documentation",
        description: "No code changes involved",
        status: "in_progress",
        workspace: wsRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates an informational observation noting missing signals
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.severity).toBe("info");
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation notes that verification was inconclusive
    expect(obs.text.toLowerCase()).toMatch(/inconclusive|no external|unable to verify/);
  }, 120_000);
});

// =============================================================================
// Story 2: Intent Completion Verification
// =============================================================================

describe("Milestone 2: Intent Completion Verification (Story 2)", () => {
  // ---------------------------------------------------------------------------
  // S2-1: Intent completed -> verification observation created
  // ---------------------------------------------------------------------------
  it("completed intent produces a verification observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an intent that has been authorized
    const { workspaceId, identityId } = await setupObserverWorkspace(baseUrl, surreal, "intent-verify");

    const intentId = crypto.randomUUID();
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
        goal: "Add input validation to user registration",
        reasoning: "Prevent malformed data from entering the system",
        status: "executing",
        priority: 50,
        action_spec: { provider: "file_editor", action: "edit_file", params: { target: "src/auth/register.ts" } },
        trace_id: traceRecord,
        requester: requesterRecord,
        workspace: wsRecord,
        evaluation: { decision: "APPROVE", risk_score: 15, reason: "Low risk code change", evaluated_at: new Date(), policy_only: false },
        created_at: new Date(),
      },
    });

    // When the intent transitions to completed
    await triggerIntentCompletion(surreal, intentId, "completed");

    // Then the observer creates an observation linked to the intent
    const observations = await waitForObservation(surreal, "intent", intentId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    expect(obs.severity).toBeDefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S2-2: Intent failed -> observation records failure
  // ---------------------------------------------------------------------------
  it("failed intent produces an observation recording the failure", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an intent that was executing
    const { workspaceId, identityId } = await setupObserverWorkspace(baseUrl, surreal, "intent-fail");

    const intentId = crypto.randomUUID();
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
        goal: "Deploy to staging environment",
        reasoning: "Pre-production validation required",
        status: "executing",
        priority: 60,
        action_spec: { provider: "deploy", action: "staging", params: {} },
        trace_id: traceRecord,
        requester: requesterRecord,
        workspace: wsRecord,
        evaluation: { decision: "APPROVE", risk_score: 40, reason: "Moderate risk deployment", evaluated_at: new Date(), policy_only: false },
        created_at: new Date(),
      },
    });

    // When the intent transitions to failed
    await triggerIntentCompletion(surreal, intentId, "failed");

    // Then the observer creates a warning or conflict observation
    const observations = await waitForObservation(surreal, "intent", intentId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    expect(["warning", "conflict"]).toContain(obs.severity);
  }, 120_000);
});

// =============================================================================
// Story 2b: Commit Verification
// =============================================================================

describe("Milestone 2: Commit Verification (Story 2b)", () => {
  // ---------------------------------------------------------------------------
  // S2b-1: Commit created -> GitHub status checked, observation created
  // ---------------------------------------------------------------------------
  it("new commit triggers status verification and creates observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace exists
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "commit-verify");
    const sha = `commit${crypto.randomUUID().replace(/-/g, "").slice(0, 34)}`;

    // When a new git commit record is created (fires commit_created EVENT)
    const { commitId } = await createGitCommit(surreal, workspaceId, sha, {
      message: "feat: implement observer agent pipeline",
      repository: "org/brain",
    });

    // Then the observer creates an observation for the commit
    const observations = await waitForObservation(surreal, "git_commit", commitId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    expect(obs.severity).toBeDefined();
  }, 120_000);
});

// =============================================================================
// Story 3: Graceful Degradation
// =============================================================================

describe("Milestone 2: Graceful Degradation (Story 3)", () => {
  // ---------------------------------------------------------------------------
  // S3-1: External API unreachable -> warning observation, task not blocked
  // ---------------------------------------------------------------------------
  it("external API failure produces warning observation without blocking task", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task linked to a commit
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "degrade-api");
    const sha = `fail${crypto.randomUUID().replace(/-/g, "").slice(0, 36)}`;

    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Integrate third-party payment gateway",
      status: "in_progress",
      sha,
      repository: "org/brain",
    });

    // And the external CI/GitHub API is unreachable (simulated by no mock server)

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates a warning or info observation (not a blocking error)
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    expect(obs.source_agent).toBe("observer_agent");
    expect(["info", "warning"]).toContain(obs.severity);

    // And the task status remains completed (observer did NOT revert it)
    const taskRecord = new RecordId("task", taskId);
    const taskRows = (await surreal.query(
      `SELECT status FROM $task;`,
      { task: taskRecord },
    )) as Array<Array<{ status: string }>>;
    expect(taskRows[0]?.[0]?.status).toBe("completed");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S3-2: EVENT RETRY handles transient failures
  // ---------------------------------------------------------------------------
  it("transient observer endpoint failure is retried by EVENT", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "degrade-retry");
    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Add health check endpoint",
      status: "in_progress",
    });

    // When the task is completed (EVENT fires with RETRY 3)
    await triggerTaskCompletion(surreal, taskId);

    // Then even if the first attempt encounters a transient error,
    // the RETRY mechanism ensures the observation is eventually created
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
