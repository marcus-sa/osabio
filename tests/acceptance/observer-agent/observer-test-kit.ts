/**
 * Observer Agent Acceptance Test Kit
 *
 * Extends the orchestrator-test-kit with observer-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/observe/:table/:id        (SurrealQL EVENT target)
 *   POST /api/observe/scan/:workspaceId  (periodic graph scan)
 */
import { RecordId, type Surreal } from "surrealdb";

// Re-export everything from orchestrator-test-kit
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  getTestUserBearerToken,
  fetchJson,
  fetchRaw,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestUserWithToken,
  type TestWorkspace,
  type TestTask,
  type TestProject,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

import {
  fetchJson,
  fetchRaw,
  type TestUser,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

// ---------------------------------------------------------------------------
// Observer-Specific Types
// ---------------------------------------------------------------------------

export type ObservationSeverity = "info" | "warning" | "conflict";

export type ObservationStatus = "open" | "acknowledged" | "resolved";

export type ObservationType =
  | "contradiction"
  | "duplication"
  | "missing"
  | "deprecated"
  | "pattern"
  | "anomaly"
  | "validation"
  | "error";

export type ObservationRecord = {
  id: RecordId<"observation">;
  text: string;
  severity: ObservationSeverity;
  status: ObservationStatus;
  observation_type?: ObservationType;
  source_agent: string;
  verified?: boolean;
  source?: string;
  data?: Record<string, unknown>;
  workspace: RecordId<"workspace">;
  created_at: string;
  updated_at?: string;
};

export type ObserverVerdict = "match" | "mismatch" | "inconclusive";

export type CreateTaskWithCommitOptions = {
  title: string;
  description?: string;
  status?: string;
  sha?: string;
  repository?: string;
  prUrl?: string;
};

export type CreateGitCommitOptions = {
  message?: string;
  repository?: string;
  authorName?: string;
  url?: string;
};

export type CreateCompletedIntentOptions = {
  goal: string;
  reasoning: string;
  actionSpec: { provider: string; action: string; params?: Record<string, unknown> };
  status?: "completed" | "failed";
};

export type MockGitHubResponse = {
  path: string;
  status: number;
  body: unknown;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

export { setupAcceptanceSuite } from "../acceptance-test-kit";

import { setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * Sets up an observer acceptance test suite with an isolated server + DB.
 */
export function setupObserverSuite(
  suiteName: string,
): () => import("../acceptance-test-kit").AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Wires all 5 SurrealQL EVENTs for the observer agent.
 * Events POST to the test server's observe endpoint.
 *
 * Must be called in beforeAll after the test server has booted.
 */
export async function wireObserverEvents(
  surreal: Surreal,
  port: number,
): Promise<void> {
  const candidateHosts = process.env.OBSERVER_CALLBACK_HOST?.trim()
    ? [process.env.OBSERVER_CALLBACK_HOST.trim()]
    : ["127.0.0.1", "host.docker.internal"];

  let baseUrl: string | undefined;
  let lastError = "";

  for (const host of candidateHosts) {
    const candidateBaseUrl = `http://${host}:${port}`;
    try {
      await surreal.query(`RETURN http::head($url);`, {
        url: `${candidateBaseUrl}/healthz`,
      });
      baseUrl = candidateBaseUrl;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!baseUrl) {
    throw new Error(
      `Unable to reach acceptance server from SurrealDB for observer callback. ` +
      `Tried hosts: ${candidateHosts.join(", ")} on port ${port}. ` +
      `Last error: ${lastError}`,
    );
  }

  // EVENT 1: task_completed — fires when task status transitions to completed/done
  await surreal.query(`
    DEFINE EVENT OVERWRITE task_completed ON task
      ASYNC
      RETRY 3
      WHEN $event = "UPDATE"
        AND ($before.status != "completed" AND $before.status != "done")
        AND ($after.status = "completed" OR $after.status = "done")
      THEN {
        http::post("${baseUrl}/api/observe/task/" + <string> meta::id($after.id), $after)
      };
  `);

  // EVENT 2: intent_completed — fires when intent status transitions to completed/failed
  await surreal.query(`
    DEFINE EVENT OVERWRITE intent_completed ON intent
      ASYNC
      RETRY 3
      WHEN $event = "UPDATE"
        AND ($before.status != "completed" AND $before.status != "failed")
        AND ($after.status = "completed" OR $after.status = "failed")
      THEN {
        http::post("${baseUrl}/api/observe/intent/" + <string> meta::id($after.id), $after)
      };
  `);

  // EVENT 3: commit_created — fires when a new git_commit record is created
  await surreal.query(`
    DEFINE EVENT OVERWRITE commit_created ON git_commit
      ASYNC
      RETRY 3
      WHEN $event = "CREATE"
      THEN {
        http::post("${baseUrl}/api/observe/git_commit/" + <string> meta::id($after.id), $after)
      };
  `);

  // EVENT 4: decision_confirmed — fires when decision status changes to confirmed/superseded
  await surreal.query(`
    DEFINE EVENT OVERWRITE decision_confirmed ON decision
      ASYNC
      RETRY 3
      WHEN $event = "UPDATE"
        AND $before.status != $after.status
        AND ($after.status = "confirmed" OR $after.status = "superseded")
      THEN {
        http::post("${baseUrl}/api/observe/decision/" + <string> meta::id($after.id), $after)
      };
  `);

  // EVENT 5: observation_peer_review — fires when non-observer observation is created
  await surreal.query(`
    DEFINE EVENT OVERWRITE observation_peer_review ON observation
      ASYNC
      RETRY 3
      WHEN $event = "CREATE" AND $after.source_agent != "observer_agent"
      THEN {
        http::post("${baseUrl}/api/observe/observation/" + <string> meta::id($after.id), $after)
      };
  `);
}

/**
 * Creates a task linked to a source commit in the graph.
 * Used as a Given-step precondition for task verification scenarios.
 */
export async function createTaskWithCommit(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateTaskWithCommitOptions,
): Promise<{ taskId: string; commitId: string; sha: string }> {
  const taskId = `task-${crypto.randomUUID()}`;
  const commitId = `commit-${crypto.randomUUID()}`;
  const sha = opts.sha ?? `abc${crypto.randomUUID().replace(/-/g, "").slice(0, 37)}`;
  const taskRecord = new RecordId("task", taskId);
  const commitRecord = new RecordId("git_commit", commitId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Create the git_commit record (but NOT via CREATE if we want to avoid triggering commit_created EVENT)
  // Use a direct insert approach to seed without firing events
  await surreal.query(
    `CREATE $commit CONTENT $content;`,
    {
      commit: commitRecord,
      content: {
        sha,
        repository: opts.repository ?? "org/repo",
        message: `feat: ${opts.title}`,
        author_name: "test-agent",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  // Create the task linked to the commit
  await surreal.query(
    `CREATE $task CONTENT $content;`,
    {
      task: taskRecord,
      content: {
        title: opts.title,
        description: opts.description ?? "Test task for observer verification",
        status: opts.status ?? "in_progress",
        source_commit: commitRecord,
        workspace: workspaceRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
  );

  return { taskId, commitId, sha };
}

/**
 * Creates a git_commit record in the graph.
 * Note: if commit_created EVENT is wired, this WILL trigger the observer.
 */
export async function createGitCommit(
  surreal: Surreal,
  workspaceId: string,
  sha: string,
  opts?: CreateGitCommitOptions,
): Promise<{ commitId: string }> {
  const commitId = `commit-${crypto.randomUUID()}`;
  const commitRecord = new RecordId("git_commit", commitId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $commit CONTENT $content;`,
    {
      commit: commitRecord,
      content: {
        sha,
        repository: opts?.repository ?? "org/repo",
        message: opts?.message ?? "chore: test commit",
        author_name: opts?.authorName ?? "test-agent",
        url: opts?.url,
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  return { commitId };
}

/**
 * Creates an intent that has reached completed or failed status.
 * Used as a Given-step precondition for intent verification scenarios.
 */
export async function createCompletedIntent(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: CreateCompletedIntentOptions,
): Promise<{ intentId: string }> {
  const intentId = `intent-${crypto.randomUUID()}`;
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", requesterId);
  const traceId = `trace-${intentId}`;
  const traceRecord = new RecordId("trace", traceId);

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content: {
      type: "intent_submission",
      actor: requesterRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: {
      goal: opts.goal,
      reasoning: opts.reasoning,
      status: opts.status ?? "completed",
      priority: 50,
      action_spec: opts.actionSpec,
      trace_id: traceRecord,
      requester: requesterRecord,
      workspace: workspaceRecord,
      evaluation: {
        decision: "APPROVE",
        risk_score: 10,
        reason: "Pre-approved for testing",
        evaluated_at: new Date(),
        policy_only: false,
      },
      created_at: new Date(),
    },
  });

  return { intentId };
}

/**
 * Creates an observation record directly in the database.
 * Used as a Given-step to seed observations from other agents for peer review testing.
 */
export async function createObservationByAgent(
  surreal: Surreal,
  workspaceId: string,
  sourceAgent: string,
  opts: {
    text: string;
    severity: ObservationSeverity;
    observationType?: ObservationType;
    targetTable?: string;
    targetId?: string;
  },
): Promise<{ observationId: string }> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content: {
      text: opts.text,
      severity: opts.severity,
      status: "open",
      observation_type: opts.observationType,
      source_agent: sourceAgent,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  // Link observation to target entity if provided
  if (opts.targetTable && opts.targetId) {
    const targetRecord = new RecordId(opts.targetTable, opts.targetId);
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: observationRecord, target: targetRecord },
    );
  }

  return { observationId };
}

/**
 * Creates a confirmed decision directly in the database.
 */
export async function createConfirmedDecision(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    summary: string;
    rationale?: string;
    status?: string;
  },
): Promise<{ decisionId: string }> {
  const decisionId = `decision-${crypto.randomUUID()}`;
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary: opts.summary,
      rationale: opts.rationale ?? "Confirmed for testing",
      status: opts.status ?? "confirmed",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return { decisionId };
}

/**
 * Triggers task completion by updating status to "completed".
 * This fires the task_completed EVENT if wired.
 */
export async function triggerTaskCompletion(
  surreal: Surreal,
  taskId: string,
): Promise<void> {
  const taskRecord = new RecordId("task", taskId);
  await surreal.query(
    `UPDATE $task SET status = "completed", updated_at = time::now();`,
    { task: taskRecord },
  );
}

/**
 * Triggers intent completion by updating status to "completed" or "failed".
 * This fires the intent_completed EVENT if wired.
 */
export async function triggerIntentCompletion(
  surreal: Surreal,
  intentId: string,
  status: "completed" | "failed" = "completed",
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);
  await surreal.query(
    `UPDATE $intent SET status = $status, updated_at = time::now();`,
    { intent: intentRecord, status },
  );
}

/**
 * Triggers decision confirmation by updating status.
 * This fires the decision_confirmed EVENT if wired.
 */
export async function triggerDecisionConfirmation(
  surreal: Surreal,
  decisionId: string,
  newStatus: "confirmed" | "superseded" = "confirmed",
): Promise<void> {
  const decisionRecord = new RecordId("decision", decisionId);
  await surreal.query(
    `UPDATE $dec SET status = $status, updated_at = time::now();`,
    { dec: decisionRecord, status: newStatus },
  );
}

/**
 * Polls for an observation linked to a given entity via the observes edge.
 * Returns when at least one observation is found, or throws on timeout.
 */
export async function waitForObservation(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
  timeoutMs = 15_000,
): Promise<ObservationRecord[]> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const observations = await getObservationsForEntity(surreal, entityTable, entityId);
    if (observations.length > 0) {
      return observations;
    }
    await Bun.sleep(250);
  }

  throw new Error(
    `No observation found for ${entityTable}:${entityId} within ${timeoutMs}ms`,
  );
}

/**
 * Queries all observations linked to an entity via the observes edge.
 */
export async function getObservationsForEntity(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
): Promise<ObservationRecord[]> {
  const entityRecord = new RecordId(entityTable, entityId);

  // Query via reverse traversal from the entity through observes edges
  const reverseRows = (await surreal.query(
    `SELECT <-observes<-observation AS obs FROM $entity;`,
    { entity: entityRecord },
  )) as Array<Array<{ obs: RecordId[] }>>;

  const obsIds = reverseRows[0]?.[0]?.obs ?? [];
  if (obsIds.length === 0) return [];

  const allObs = (await surreal.query(
    `SELECT * FROM observation WHERE id IN $ids;`,
    { ids: obsIds },
  )) as Array<ObservationRecord[]>;

  return allObs[0] ?? [];
}

/**
 * Queries all observations in a workspace, optionally filtered by source agent.
 */
export async function getWorkspaceObservations(
  surreal: Surreal,
  workspaceId: string,
  sourceAgent?: string,
): Promise<ObservationRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (sourceAgent) {
    const rows = (await surreal.query(
      `SELECT * FROM observation WHERE workspace = $ws AND source_agent = $agent ORDER BY created_at DESC;`,
      { ws: workspaceRecord, agent: sourceAgent },
    )) as Array<ObservationRecord[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM observation WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<ObservationRecord[]>;
  return rows[0] ?? [];
}

/**
 * Triggers the periodic graph scan endpoint.
 */
export async function triggerGraphScan(
  baseUrl: string,
  workspaceId: string,
  headers: Record<string, string>,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/observe/scan/${workspaceId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}

/**
 * Creates a simple mock HTTP server that responds to GitHub-like API paths.
 * Returns a cleanup function to stop the server.
 */
export function createMockGitHubServer(
  responses: MockGitHubResponse[],
): { url: string; stop: () => void } {
  const responseMap = new Map<string, { status: number; body: unknown }>();
  for (const r of responses) {
    responseMap.set(r.path, { status: r.status, body: r.body });
  }

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const match = responseMap.get(url.pathname);
      if (match) {
        return new Response(JSON.stringify(match.body), {
          status: match.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

/**
 * Creates a test workspace and identity for observer tests.
 * Returns workspace ID, identity ID, and the test user.
 */
export async function setupObserverWorkspace(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
  identityId: string;
}> {
  const { createTestUser, createTestWorkspace } = await import(
    "../coding-agent-orchestrator/orchestrator-test-kit"
  );

  const user = await createTestUser(baseUrl, suffix);
  const workspace = await createTestWorkspace(baseUrl, user);

  // Create an agent identity in this workspace
  const identityId = `id-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: `Observer Test Agent ${suffix}`,
      type: "agent",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { user, workspaceId: workspace.workspaceId, identityId };
}
