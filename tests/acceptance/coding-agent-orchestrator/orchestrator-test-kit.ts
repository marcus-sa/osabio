/**
 * Orchestrator Acceptance Test Kit
 *
 * Extends the smoke-test-kit with orchestrator-specific helpers.
 * Boots a Brain server + SurrealDB with isolated namespace.
 * Provides helpers for workspace/task/session setup and agent spawning mock.
 */
import { afterAll, beforeAll } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorTestRuntime = {
  baseUrl: string;
  surreal: Surreal;
  namespace: string;
  database: string;
  port: number;
};

export type TestUser = {
  headers: Record<string, string>;
};

export type TestWorkspace = {
  workspaceId: string;
  conversationId: string;
};

export type TestTask = {
  taskId: string;
  taskRecord: RecordId<"task">;
};

export type TestProject = {
  projectId: string;
  projectRecord: RecordId<"project">;
};

export type AssignmentResponse = {
  agentSessionId: string;
  streamId: string;
  streamUrl: string;
};

export type SessionStatusResponse = {
  agentSessionId: string;
  orchestratorStatus: string;
  worktreeBranch?: string;
  startedAt: string;
  lastEventAt?: string;
};

export type ReviewResponse = {
  taskTitle: string;
  diff: {
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      additions: number;
      deletions: number;
    }>;
    rawDiff: string;
    stats: {
      filesChanged: number;
      insertions: number;
      deletions: number;
    };
  };
  session: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    startedAt?: string;
    lastEventAt?: string;
    toolCallCount?: number;
    filesEdited?: number;
  };
};

export type TestUserWithToken = TestUser & {
  bearerHeaders: Record<string, string>;
  accessToken: string;
};

// ---------------------------------------------------------------------------
// Infrastructure Setup
// ---------------------------------------------------------------------------

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const portBase = Number(process.env.SMOKE_PORT_BASE ?? "3200");

export function setupOrchestratorSuite(
  suiteName: string,
): () => OrchestratorTestRuntime {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const namespace = `orch_${runId}`;
  const suiteSlug = suiteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const database = `${suiteSlug || "suite"}_${Math.floor(Math.random() * 100000)}`;

  let runtime: OrchestratorTestRuntime | undefined;
  let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
  let setupSucceeded = false;

  beforeAll(async () => {
    const port = portBase + Math.floor(Math.random() * 20000);
    const baseUrl = `http://127.0.0.1:${port}`;

    const surreal = new Surreal();
    await withTimeout(
      () => surreal.connect(surrealUrl),
      10_000,
      "connect to SurrealDB",
    );
    await withTimeout(
      () =>
        surreal.signin({
          username: surrealUsername,
          password: surrealPassword,
        }),
      10_000,
      "authenticate with SurrealDB",
    );

    await withTimeout(
      () => surreal.query(`DEFINE NAMESPACE ${namespace};`),
      10_000,
      "define test namespace",
    );
    await withTimeout(
      () => surreal.use({ namespace }),
      10_000,
      "switch to test namespace",
    );
    await withTimeout(
      () => surreal.query(`DEFINE DATABASE ${database};`),
      10_000,
      "define test database",
    );
    await withTimeout(
      () => surreal.use({ namespace, database }),
      10_000,
      "switch to test namespace/database",
    );

    const schemaSql = readFileSync(
      join(process.cwd(), "schema", "surreal-schema.surql"),
      "utf8",
    );
    await withTimeout(() => surreal.query(schemaSql), 20_000, "apply schema");

    serverProcess = Bun.spawn(["bun", "run", "app/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SURREAL_NAMESPACE: namespace,
        SURREAL_DATABASE: database,
        BETTER_AUTH_URL: baseUrl,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ??
          "smoke-test-secret-at-least-32-chars-long",
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "smoke-test-github-id",
        GITHUB_CLIENT_SECRET:
          process.env.GITHUB_CLIENT_SECRET ?? "smoke-test-github-secret",
        // Orchestrator-specific: disable real agent spawning in tests
        ORCHESTRATOR_MOCK_AGENT: "true",
      },
      stdout: "pipe",
      stderr: "inherit",
    });

    await waitForHealth(baseUrl, serverProcess, 15_000);
    runtime = { baseUrl, surreal, namespace, database, port };
    setupSucceeded = true;
  }, 60_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
    }

    if (!runtime) return;

    if (setupSucceeded && !process.env.SMOKE_KEEP_DB) {
      try {
        await withTimeout(
          () => runtime!.surreal.query(`REMOVE DATABASE ${database};`),
          10_000,
          "remove test database",
        );
      } catch {
        // Best effort cleanup.
      }

      try {
        await withTimeout(
          () => runtime!.surreal.query(`REMOVE NAMESPACE ${namespace};`),
          10_000,
          "remove test namespace",
        );
      } catch {
        // Best effort cleanup.
      }
    }

    await withTimeout(
      () => runtime!.surreal.close(),
      2_000,
      "close SurrealDB",
    ).catch(() => undefined);
  }, 20_000);

  return () => {
    if (!runtime) {
      throw new Error(
        "Orchestrator runtime requested before suite setup completed",
      );
    }
    return runtime;
  };
}

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Creates an authenticated test user and returns auth headers.
 */
export async function createTestUser(
  baseUrl: string,
  suffix: string,
): Promise<TestUser> {
  const email = `orch-${Date.now()}-${suffix}@test.local`;
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      email,
      password: "test-password-123",
    }),
    redirect: "manual",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create test user (${response.status}): ${body}`);
  }

  const setCookie = response.headers.getSetCookie();
  if (!setCookie || setCookie.length === 0) {
    throw new Error("Sign-up did not return session cookies");
  }

  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  return { headers: { Cookie: cookieHeader } };
}

/**
 * Creates a workspace for testing.
 */
export async function createTestWorkspace(
  baseUrl: string,
  user: TestUser,
  name?: string,
  options?: { repoPath?: string | false },
): Promise<TestWorkspace> {
  // Default to process.cwd() (a valid git repo) unless explicitly disabled
  const repoPath = options?.repoPath === false
    ? undefined
    : (options?.repoPath ?? process.cwd());

  const workspace = await fetchJson<TestWorkspace>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: name ?? `Orchestrator Test ${Date.now()}`,
        ...(repoPath ? { repoPath } : {}),
      }),
    },
  );
  return workspace;
}

/**
 * Creates a task in assignable status via direct DB insertion.
 * Uses SurrealDB directly because task creation normally goes through
 * the extraction pipeline or PM agent, but acceptance tests need
 * tasks in specific states as preconditions.
 */
export async function createReadyTask(
  surreal: Surreal,
  workspaceId: string,
  options: {
    title: string;
    description?: string;
    status?: string;
    projectId?: string;
  },
): Promise<TestTask> {
  const taskId = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    title: options.title,
    description: options.description ?? "Test task for orchestrator acceptance tests",
    status: options.status ?? "ready",
    created_at: new Date(),
    updated_at: new Date(),
    workspace: workspaceRecord,
  };

  if (options.projectId) {
    const projectRecord = new RecordId("project", options.projectId);
    await surreal.query(
      `CREATE $task CONTENT $content;
       RELATE $task->belongs_to->$project SET added_at = time::now();`,
      { task: taskRecord, content: { ...content }, project: projectRecord },
    );
  } else {
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content,
    });
  }

  return { taskId, taskRecord };
}

/**
 * Creates a project for grouping tasks.
 */
export async function createTestProject(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<TestProject> {
  const projectId = `proj-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $project CONTENT $content;
     RELATE $ws->has_project->$project SET added_at = time::now();`,
    {
      project: projectRecord,
      ws: workspaceRecord,
      content: {
        name,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
        workspace: workspaceRecord,
      },
    },
  );

  return { projectId, projectRecord };
}

/**
 * Assigns a task to a coding agent via the orchestrator endpoint.
 */
export async function assignTaskToAgent(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  taskId: string,
): Promise<AssignmentResponse> {
  return fetchJson<AssignmentResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/assign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ taskId }),
    },
  );
}

/**
 * Gets the current status of an agent session.
 */
export async function getSessionStatus(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<SessionStatusResponse> {
  return fetchJson<SessionStatusResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}`,
    { headers: user.headers },
  );
}

/**
 * Lists active agent sessions for a workspace.
 */
export async function listActiveSessions(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<SessionStatusResponse[]> {
  return fetchJson<SessionStatusResponse[]>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions`,
    { headers: user.headers },
  );
}

/**
 * Accepts completed agent work, merging changes.
 */
export async function acceptAgentWork(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<{ accepted: boolean }> {
  return fetchJson<{ accepted: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
    },
  );
}

/**
 * Rejects agent work with feedback for the agent to incorporate.
 */
export async function rejectWithFeedback(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
  feedback: string,
): Promise<{ rejected: boolean; continuing: boolean }> {
  return fetchJson<{ rejected: boolean; continuing: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ feedback }),
    },
  );
}

/**
 * Aborts an active agent session and cleans up resources.
 */
export async function abortAgentSession(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<{ aborted: boolean }> {
  return fetchJson<{ aborted: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/abort`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
    },
  );
}

/**
 * Gets the review summary (diff, session trace) for completed agent work.
 */
export async function getReviewSummary(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<ReviewResponse> {
  return fetchJson<ReviewResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/review`,
    { headers: user.headers },
  );
}

/**
 * Queries task status directly from the database.
 */
export async function getTaskStatus(
  surreal: Surreal,
  taskId: string,
): Promise<string> {
  const taskRecord = new RecordId("task", taskId);
  const rows = (await surreal.query(
    `SELECT status FROM $task;`,
    { task: taskRecord },
  )) as Array<Array<{ status: string }>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Task ${taskId} not found`);
  }
  return result.status;
}

/**
 * Queries agent session records for a task.
 */
export async function getAgentSessionsForTask(
  surreal: Surreal,
  taskId: string,
): Promise<
  Array<{
    id: RecordId;
    orchestrator_status: string;
    agent: string;
  }>
> {
  const taskRecord = new RecordId("task", taskId);
  const rows = (await surreal.query(
    `SELECT id, orchestrator_status, agent FROM agent_session WHERE task_id = $task;`,
    { task: taskRecord },
  )) as Array<
    Array<{ id: RecordId; orchestrator_status: string; agent: string }>
  >;
  return rows[0] ?? [];
}

/**
 * Transitions an agent session to a given status via direct DB update.
 * Used in tests to simulate agent lifecycle without a real agent process.
 */
export async function simulateSessionStatus(
  surreal: Surreal,
  sessionId: string,
  status: string,
): Promise<void> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  await surreal.update(sessionRecord).merge({
    orchestrator_status: status,
  });
}

/**
 * Attempts to fetch a URL and returns the raw Response,
 * useful for asserting error status codes.
 */
export async function fetchRaw(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, init);
}

// ---------------------------------------------------------------------------
// OAuth / JWT Token Helpers (for MCP endpoint tests)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const MCP_SCOPES = "graph:read graph:reason decision:write task:write observation:write question:write session:write offline_access";

/**
 * Obtains a JWT Bearer token for a test user via the full OAuth 2.1 flow.
 * Required for MCP endpoints which validate JWT tokens (not session cookies).
 *
 * Flow: register OAuth client → skip consent → authorize with PKCE → exchange for JWT
 */
export async function getTestUserBearerToken(
  baseUrl: string,
  surreal: Surreal,
  user: TestUser,
  scopes?: string,
): Promise<TestUserWithToken> {
  // Trigger JWKS key generation
  await fetch(`${baseUrl}/api/auth/jwks`);

  // Register a public OAuth client via DCR
  const dcrRes = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `test-client-${Date.now()}`,
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!dcrRes.ok) {
    throw new Error(`DCR failed: ${dcrRes.status} ${await dcrRes.text()}`);
  }

  const { client_id } = (await dcrRes.json()) as { client_id: string };

  // Skip consent for test clients
  await surreal.query(
    `UPDATE oauthClient SET skipConsent = true WHERE clientId = $cid;`,
    { cid: client_id },
  );

  // Get authorization code with PKCE
  const { verifier, challenge } = generatePkce();
  const authUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes ?? MCP_SCOPES);
  authUrl.searchParams.set("state", "test-state");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Pass resource so better-auth issues a JWT (not opaque token)
  authUrl.searchParams.set("resource", baseUrl);

  const authRes = await fetch(authUrl.toString(), {
    headers: user.headers,
    redirect: "manual",
  });

  if (authRes.status !== 302) {
    const body = await authRes.text();
    throw new Error(`OAuth authorize did not redirect: ${authRes.status} body=${body}`);
  }

  const location = authRes.headers.get("location");
  if (!location) throw new Error("No location header in auth redirect");
  const redirectUrl = new URL(location, baseUrl);
  const code = redirectUrl.searchParams.get("code") ?? "";
  if (!code) {
    const error = redirectUrl.searchParams.get("error");
    throw new Error(`No code in redirect: ${location} (error=${error})`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:9999/callback",
      client_id,
      code_verifier: verifier,
      resource: baseUrl,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    ...user,
    accessToken: tokens.access_token,
    bearerHeaders: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
  };
}

// ---------------------------------------------------------------------------
// General Helpers
// ---------------------------------------------------------------------------

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

async function waitForHealth(
  url: string,
  process: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof process.exitCode === "number") {
      const stderr = process.stderr
        ? await new Response(process.stderr).text()
        : "";
      throw new Error(
        `Server exited early with code ${process.exitCode}\n${stderr}`,
      );
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for server health at ${url}/healthz`);
}

async function withTimeout<T>(
  callback: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await Promise.race([
    callback(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    }),
  ]);
}
