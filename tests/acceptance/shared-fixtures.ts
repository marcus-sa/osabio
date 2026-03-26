/**
 * Shared Test Fixtures — Canonical entity creation helpers
 *
 * Single source of truth for creating test entities in SurrealDB.
 * Domain-specific test kits compose these helpers rather than reimplementing them.
 *
 * Types here mirror the SurrealDB schema with all required fields enforced
 * at compile time, so schema changes only need updating in one place.
 */
import { createHash } from "crypto";
import { RecordId, type Surreal } from "surrealdb";
export { createTestUser, type TestUser } from "./acceptance-test-kit";

// ---------------------------------------------------------------------------
// Shared Types — Schema-aligned, required fields enforced
// ---------------------------------------------------------------------------

export type ActionSpec = {
  provider: string;
  action: string;
  params: Record<string, unknown>;
};

export type EvaluationResult = {
  decision: "APPROVE" | "REJECT";
  risk_score: number;
  reason: string;
  evaluated_at: Date;
  policy_only: boolean;
};

// ---------------------------------------------------------------------------
// Workspace + Identity (direct DB creation, no HTTP)
// ---------------------------------------------------------------------------

export type DirectWorkspaceResult = {
  workspaceId: string;
  workspaceRecord: RecordId<"workspace">;
  identityId: string;
  identityRecord: RecordId<"identity">;
};

/**
 * Creates a workspace + identity + member_of edge directly in SurrealDB.
 * Use when tests need an isolated workspace without going through HTTP signup.
 */
export async function createWorkspaceDirectly(
  surreal: Surreal,
  suffix: string,
  opts?: {
    workspaceName?: string;
    identityName?: string;
    identityType?: "human" | "agent";
    repoPath?: string;
  },
): Promise<DirectWorkspaceResult> {
  const workspaceId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  await surreal.query(
    `CREATE $workspace CONTENT $content;`,
    {
      workspace: workspaceRecord,
      content: {
        name: opts?.workspaceName ?? `Test Workspace ${suffix}`,
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: new Date(),
        created_at: new Date(),
        ...(opts?.repoPath ? { repo_path: opts.repoPath } : {}),
      },
    },
  );

  await surreal.query(
    `CREATE $identity CONTENT $content;`,
    {
      identity: identityRecord,
      content: {
        name: opts?.identityName ?? `Test User ${suffix}`,
        type: opts?.identityType ?? "human",
        identity_status: "active",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { workspaceId, workspaceRecord, identityId, identityRecord };
}

// ---------------------------------------------------------------------------
// Workspace (HTTP — session-authenticated)
// ---------------------------------------------------------------------------

export type HttpWorkspaceResult = {
  workspaceId: string;
};

/**
 * Creates a workspace via HTTP API so the authenticated person gets proper
 * member_of edges wired by the server. Use this when tests exercise routes
 * that validate workspace membership through the Better Auth session.
 *
 * Optionally sets `repo_path` on the workspace for orchestrator tests that
 * need worktree support.
 */
export async function createWorkspaceViaHttp(
  baseUrl: string,
  user: { headers: Record<string, string> },
  surreal: Surreal,
  opts?: { repoPath?: string },
): Promise<HttpWorkspaceResult> {
  const response = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({ name: `Test Workspace ${crypto.randomUUID()}` }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create workspace: ${response.status}`);
  }
  const body = (await response.json()) as { workspaceId: string };

  if (opts?.repoPath) {
    const workspaceRecord = new RecordId("workspace", body.workspaceId);
    await surreal.query(
      `UPDATE $ws SET repo_path = $path;`,
      { ws: workspaceRecord, path: opts.repoPath },
    );
  }

  return { workspaceId: body.workspaceId };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Creates an identity record + member_of edge.
 * Use when you already have a workspace and need an additional identity.
 */
export async function createIdentity(
  surreal: Surreal,
  workspaceId: string,
  name: string,
  type: "human" | "agent" = "agent",
): Promise<{ identityId: string; identityRecord: RecordId<"identity"> }> {
  const identityId = crypto.randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $identity CONTENT $content;`,
    {
      identity: identityRecord,
      content: {
        name,
        type,
        identity_status: "active",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { identityId, identityRecord };
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type CreateIntentOpts = {
  goal: string;
  reasoning?: string;
  status?: string;
  priority?: number;
  actionSpec?: ActionSpec;
  evaluation?: EvaluationResult;
  budgetLimit?: { amount: number; currency: string };
  taskId?: string;
};

/**
 * Creates an intent + trace record directly in SurrealDB.
 * Canonical helper — all intent creation in tests should use this.
 */
export async function createIntentDirectly(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: CreateIntentOpts,
): Promise<{ intentId: string; intentRecord: RecordId<"intent">; traceRecord: RecordId<"trace"> }> {
  const intentId = crypto.randomUUID();
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", requesterId);
  const traceId = crypto.randomUUID();
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

  const intentContent: Record<string, unknown> = {
    goal: opts.goal,
    reasoning: opts.reasoning ?? "Test intent",
    status: opts.status ?? "draft",
    priority: opts.priority ?? 50,
    action_spec: opts.actionSpec ?? { provider: "test", action: "test", params: {} },
    trace_id: traceRecord,
    requester: requesterRecord,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (opts.evaluation !== undefined) intentContent.evaluation = opts.evaluation;
  if (opts.budgetLimit !== undefined) intentContent.budget_limit = opts.budgetLimit;

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: intentContent,
  });

  if (opts.taskId) {
    const taskRecord = new RecordId("task", opts.taskId);
    await surreal.query(
      `RELATE $intent->triggered_by->$task SET created_at = time::now();`,
      { intent: intentRecord, task: taskRecord },
    );
  }

  return { intentId, intentRecord, traceRecord };
}

// ---------------------------------------------------------------------------
// Git Commit
// ---------------------------------------------------------------------------

export type CreateGitCommitOpts = {
  message?: string;
  repository?: string;
  authorName?: string;
  url?: string;
};

/**
 * Creates a git_commit record directly in SurrealDB.
 */
export async function createGitCommitDirectly(
  surreal: Surreal,
  workspaceId: string,
  sha: string,
  opts?: CreateGitCommitOpts,
): Promise<{ commitId: string; commitRecord: RecordId<"git_commit"> }> {
  const commitId = crypto.randomUUID();
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

  return { commitId, commitRecord };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type CreateDecisionOpts = {
  summary: string;
  rationale?: string;
  status?: string;
  created_at?: Date;
};

/**
 * Creates a decision record directly in SurrealDB.
 */
export async function createDecisionDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateDecisionOpts,
): Promise<{ decisionId: string; decisionRecord: RecordId<"decision"> }> {
  const decisionId = crypto.randomUUID();
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary: opts.summary,
      rationale: opts.rationale ?? "Test decision",
      status: opts.status ?? "confirmed",
      workspace: workspaceRecord,
      created_at: opts.created_at ?? new Date(),
      updated_at: new Date(),
    },
  });

  return { decisionId, decisionRecord };
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationSeverity = "info" | "warning" | "conflict";
export type ObservationStatus = "open" | "acknowledged" | "resolved";

export type CreateObservationOpts = {
  text: string;
  severity: ObservationSeverity;
  observationType?: string;
  sourceAgent: string;
  targetTable?: string;
  targetId?: string;
};

/**
 * Creates an observation record directly in SurrealDB.
 * Optionally links to a target entity via an observes edge.
 */
export async function createObservationDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateObservationOpts,
): Promise<{ observationId: string; observationRecord: RecordId<"observation"> }> {
  const observationId = crypto.randomUUID();
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content: {
      text: opts.text,
      severity: opts.severity,
      status: "open" as const,
      observation_type: opts.observationType,
      source_agent: opts.sourceAgent,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  if (opts.targetTable && opts.targetId) {
    const targetRecord = new RecordId(opts.targetTable, opts.targetId);
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: observationRecord, target: targetRecord },
    );
  }

  return { observationId, observationRecord };
}

// ---------------------------------------------------------------------------
// Workspace Observations Query
// ---------------------------------------------------------------------------

/**
 * Queries all observations in a workspace, optionally filtered by source agent.
 */
export async function queryWorkspaceObservations(
  surreal: Surreal,
  workspaceId: string,
  sourceAgent?: string,
): Promise<Array<{
  id: RecordId;
  text: string;
  severity: string;
  status: string;
  source_agent: string;
  observation_type?: string;
  workspace: RecordId<"workspace">;
  created_at: string;
  updated_at?: string;
}>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  type ObsRow = {
    id: RecordId;
    text: string;
    severity: string;
    status: string;
    source_agent: string;
    observation_type?: string;
    workspace: RecordId<"workspace">;
    created_at: string;
    updated_at?: string;
  };

  if (sourceAgent) {
    const rows = (await surreal.query(
      `SELECT * FROM observation WHERE workspace = $ws AND source_agent = $agent ORDER BY created_at DESC;`,
      { ws: workspaceRecord, agent: sourceAgent },
    )) as Array<ObsRow[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM observation WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<ObsRow[]>;
  return rows[0] ?? [];
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type CreateTaskOpts = {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  repoPath?: string;
};

/**
 * Creates a task record directly in SurrealDB.
 */
export async function createTaskDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateTaskOpts,
): Promise<{ taskId: string; taskRecord: RecordId<"task"> }> {
  const taskId = crypto.randomUUID();
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: opts.title,
      description: opts.description,
      status: opts.status ?? "ready",
      priority: opts.priority,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { taskId, taskRecord };
}

// ---------------------------------------------------------------------------
// Proxy Token
// ---------------------------------------------------------------------------

/**
 * Seed a proxy_token record for acceptance tests and return the raw token.
 * The raw token is sent as `X-Brain-Auth` header; the server hashes it with
 * SHA-256 and looks up the hash in the `proxy_token` table.
 *
 * Optional `sessionId` and `intentId` link the token to an agent_session
 * and authorizing intent (R2 intent-gated-mcp governance).
 */
export async function seedProxyToken(
  surreal: Surreal,
  identityId: string,
  workspaceId: string,
  opts?: { sessionId?: string; intentId?: string },
): Promise<string> {
  const rawToken = `brn_test_${crypto.randomUUID()}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenId = crypto.randomUUID();
  const tokenRecord = new RecordId("proxy_token", tokenId);

  const content: Record<string, unknown> = {
    token_hash: tokenHash,
    workspace: new RecordId("workspace", workspaceId),
    identity: new RecordId("identity", identityId),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    revoked: false,
    created_at: new Date(),
  };
  if (opts?.sessionId) content.session = new RecordId("agent_session", opts.sessionId);
  if (opts?.intentId) content.intent = new RecordId("intent", opts.intentId);

  await surreal.query(`CREATE $rec CONTENT $content;`, {
    rec: tokenRecord,
    content,
  });

  return rawToken;
}

// ---------------------------------------------------------------------------
// Agent Session
// ---------------------------------------------------------------------------

/**
 * Creates an agent_session record directly in SurrealDB.
 * Use for orchestrator and MCP governance acceptance tests.
 */
export async function createAgentSessionDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts?: {
    agent?: string;
    status?: string;
    sessionType?: string;
    provider?: string;
    taskId?: string;
  },
): Promise<{ sessionId: string; sessionRecord: RecordId<"agent_session"> }> {
  const sessionId = crypto.randomUUID();
  const sessionRecord = new RecordId("agent_session", sessionId);

  const content: Record<string, unknown> = {
    workspace: new RecordId("workspace", workspaceId),
    agent: opts?.agent ?? "claude",
    session_type: opts?.sessionType ?? "sandbox_agent",
    provider: opts?.provider ?? "local",
    orchestrator_status: opts?.status ?? "active",
    external_session_id: `ext-${sessionId}`,
    created_at: new Date(),
    started_at: new Date(),
  };
  if (opts?.taskId) content.task_id = new RecordId("task", opts.taskId);

  await surreal.query(`CREATE $record CONTENT $content;`, {
    record: sessionRecord,
    content,
  });

  return { sessionId, sessionRecord };
}

// ---------------------------------------------------------------------------
// MCP Tool
// ---------------------------------------------------------------------------

/**
 * Creates an mcp_tool record directly in SurrealDB.
 * Use for tool registry and MCP governance acceptance tests.
 */
export async function createMcpToolDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    name: string;
    toolkit: string;
    riskLevel?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  },
): Promise<{ toolId: string; toolRecord: RecordId<"mcp_tool"> }> {
  const toolId = crypto.randomUUID();
  const toolRecord = new RecordId("mcp_tool", toolId);

  await surreal.query(`CREATE $rec CONTENT $content;`, {
    rec: toolRecord,
    content: {
      name: opts.name,
      toolkit: opts.toolkit,
      description: opts.description ?? `${opts.toolkit}:${opts.name} tool`,
      input_schema: opts.inputSchema ?? { type: "object", properties: {} },
      risk_level: opts.riskLevel ?? "low",
      workspace: new RecordId("workspace", workspaceId),
      status: "active",
      created_at: new Date(),
    },
  });

  return { toolId, toolRecord };
}

// ---------------------------------------------------------------------------
// Tool Grant (can_use edge)
// ---------------------------------------------------------------------------

/**
 * Creates a can_use relation edge granting an identity access to an MCP tool.
 */
export async function grantToolToIdentity(
  surreal: Surreal,
  identityId: string,
  toolId: string,
): Promise<void> {
  await surreal.query(
    `RELATE $identity->can_use->$tool SET granted_at = time::now();`,
    {
      identity: new RecordId("identity", identityId),
      tool: new RecordId("mcp_tool", toolId),
    },
  );
}

// ---------------------------------------------------------------------------
// Gates Edge (intent → agent_session)
// ---------------------------------------------------------------------------

/**
 * Creates a gates relation edge linking an authorized intent to an agent session.
 * Direction: intent → gates → agent_session (per schema).
 */
export async function createGatesEdge(
  surreal: Surreal,
  intentId: string,
  sessionId: string,
): Promise<void> {
  await surreal.query(
    `RELATE $intent->gates->$sess SET created_at = time::now();`,
    {
      intent: new RecordId("intent", intentId),
      sess: new RecordId("agent_session", sessionId),
    },
  );
}
