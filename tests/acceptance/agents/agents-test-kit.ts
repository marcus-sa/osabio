/**
 * Agent Management Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with agent-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   GET    /api/workspaces/:workspaceId/agents          (list agents)
 *   POST   /api/workspaces/:workspaceId/agents          (create agent)
 *   GET    /api/workspaces/:workspaceId/agents/:agentId (agent detail)
 *   PUT    /api/workspaces/:workspaceId/agents/:agentId (update agent)
 *   DELETE /api/workspaces/:workspaceId/agents/:agentId (delete agent)
 *   SurrealDB direct queries                            (verification of outcomes)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  createWorkspaceDirectly,
  createWorkspaceViaHttp,
  type DirectWorkspaceResult,
} from "../shared-fixtures";

// ---------------------------------------------------------------------------
// Re-exports from shared kit
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  fetchJson,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
} from "../acceptance-test-kit";

import {
  setupAcceptanceSuite,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Agent Domain Types
// ---------------------------------------------------------------------------

export type AgentRuntime = "brain" | "sandbox" | "external";

export type AuthorityScopeInput = {
  action: string;
  permission: "auto" | "propose" | "blocked";
};

export type SandboxConfig = {
  coding_agents?: string[];
  env_vars?: { key: string; value: string }[];
  image?: string;
  snapshot?: string;
  model?: string;
};

export type CreateAgentInput = {
  name: string;
  description?: string;
  runtime: "sandbox" | "external";
  model?: string;
  sandbox_config?: SandboxConfig;
  authority_scopes?: AuthorityScopeInput[];
};

export type AgentListItem = {
  id: string;
  name: string;
  description?: string;
  runtime: AgentRuntime;
  model?: string;
  identity_id: string;
  created_at: string;
};

export type AgentDetailResponse = {
  agent: AgentListItem & { sandbox_config?: SandboxConfig };
  identity: { id: string; name: string; type: string; role?: string };
  authority_scopes: { action: string; permission: string }[];
  sessions: Array<{
    id: string;
    started_at: string;
    ended_at?: string;
    orchestrator_status?: string;
    summary?: string;
  }>;
};

export type CreateAgentResponse = {
  agent: AgentListItem;
  proxy_token?: string;
};

export type DeleteAgentResponse = {
  deleted: true;
  sessions_aborted: number;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up an agent acceptance test suite with an isolated server + DB.
 */
export function setupAgentSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Creates a workspace with a session-authenticated user.
 * Use when tests exercise browser-facing routes that validate workspace
 * membership through the Better Auth session.
 */
export async function createAgentTestWorkspace(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
}> {
  const { createTestUser } = await import("../acceptance-test-kit");
  const user = await createTestUser(baseUrl, `agent-${suffix}-${crypto.randomUUID()}`);
  const { workspaceId } = await createWorkspaceViaHttp(baseUrl, user, surreal);
  return { user, workspaceId };
}

/**
 * Creates a workspace directly in SurrealDB (no HTTP, no session auth).
 * Use for tests that only need data in the DB without going through HTTP signup.
 */
export async function createAgentTestWorkspaceDirect(
  surreal: Surreal,
  suffix: string,
): Promise<DirectWorkspaceResult> {
  return createWorkspaceDirectly(surreal, suffix, {
    workspaceName: `Agent Test Workspace ${suffix}`,
  });
}

// ---------------------------------------------------------------------------
// HTTP Helpers -- Driving Port Invocations
// ---------------------------------------------------------------------------

/**
 * Lists all agents in a workspace via the HTTP endpoint.
 */
export async function listAgentsViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/agents`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

/**
 * Creates an agent via the HTTP endpoint.
 */
export async function createAgentViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: CreateAgentInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/agents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * Gets agent detail via the HTTP endpoint.
 */
export async function getAgentDetailViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  agentId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

/**
 * Updates an agent via the HTTP endpoint.
 */
export async function updateAgentViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  agentId: string,
  input: Partial<CreateAgentInput>,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * Deletes an agent via the HTTP endpoint.
 */
export async function deleteAgentViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  agentId: string,
  confirmName: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ confirm_name: confirmName }),
    },
  );
}

// ---------------------------------------------------------------------------
// Verification Helpers -- Direct DB Queries for Then-Step Assertions
// ---------------------------------------------------------------------------

/**
 * Queries the agent record directly from SurrealDB.
 */
export async function getAgentFromDb(
  surreal: Surreal,
  agentId: string,
): Promise<Record<string, unknown> | undefined> {
  const agentRecord = new RecordId("agent", agentId);
  const rows = (await surreal.query(
    `SELECT * FROM $agent;`,
    { agent: agentRecord },
  )) as Array<Array<Record<string, unknown>>>;
  return rows[0]?.[0];
}

/**
 * Queries the identity record linked to an agent via identity_agent edge.
 */
export async function getIdentityForAgent(
  surreal: Surreal,
  agentId: string,
): Promise<Record<string, unknown> | undefined> {
  const agentRecord = new RecordId("agent", agentId);
  const rows = (await surreal.query(
    `SELECT VALUE in FROM identity_agent WHERE out = $agent LIMIT 1;`,
    { agent: agentRecord },
  )) as Array<Array<RecordId>>;
  const identityRecord = rows[0]?.[0];
  if (!identityRecord) return undefined;

  const identityRows = (await surreal.query(
    `SELECT * FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<Record<string, unknown>>>;
  return identityRows[0]?.[0];
}

/**
 * Queries authorized_to edges for an identity.
 */
export async function getAuthorityEdgesForIdentity(
  surreal: Surreal,
  identityId: string,
): Promise<Array<{ action: string; permission: string }>> {
  const identityRecord = new RecordId("identity", identityId);
  const rows = (await surreal.query(
    `SELECT out.action AS action, permission FROM authorized_to WHERE in = $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ action: string; permission: string }>>;
  return rows[0] ?? [];
}

/**
 * Queries the member_of edge between an identity and workspace.
 */
export async function hasMemberOfEdge(
  surreal: Surreal,
  identityId: string,
  workspaceId: string,
): Promise<boolean> {
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT id FROM member_of WHERE in = $identity AND out = $ws;`,
    { identity: identityRecord, ws: workspaceRecord },
  )) as Array<Array<{ id: RecordId }>>;
  return (rows[0]?.length ?? 0) > 0;
}

/**
 * Queries proxy_token records for an identity.
 */
export async function getProxyTokensForIdentity(
  surreal: Surreal,
  identityId: string,
): Promise<Array<Record<string, unknown>>> {
  const identityRecord = new RecordId("identity", identityId);
  const rows = (await surreal.query(
    `SELECT * FROM proxy_token WHERE identity = $identity;`,
    { identity: identityRecord },
  )) as Array<Array<Record<string, unknown>>>;
  return rows[0] ?? [];
}

/**
 * Checks whether an agent record exists in the database.
 */
export async function agentExistsInDb(
  surreal: Surreal,
  agentId: string,
): Promise<boolean> {
  const agent = await getAgentFromDb(surreal, agentId);
  return agent !== undefined;
}

/**
 * Checks whether an identity record exists in the database.
 */
export async function identityExistsInDb(
  surreal: Surreal,
  identityId: string,
): Promise<boolean> {
  const identityRecord = new RecordId("identity", identityId);
  const rows = (await surreal.query(
    `SELECT id FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ id: RecordId }>>;
  return (rows[0]?.length ?? 0) > 0;
}

/**
 * Creates a brain agent directly in SurrealDB (for seeding test state).
 * Mirrors the identity bootstrap that creates system agents.
 * Writes both `runtime` and `agent_type` fields — this matches the parallel-write
 * migration strategy (ADR-081) where both fields coexist during the transition period.
 */
export async function seedBrainAgent(
  surreal: Surreal,
  workspaceId: string,
  name: string,
  opts?: { description?: string; agentType?: string },
): Promise<{ agentId: string; identityId: string }> {
  const agentId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const agentRecord = new RecordId("agent", agentId);
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $agent CONTENT $content;`, {
    agent: agentRecord,
    content: {
      name,
      runtime: "brain",
      agent_type: opts?.agentType ?? "chat_agent",
      description: opts?.description ?? `Brain agent: ${name}`,
      managed_by: identityRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name,
      type: "agent",
      role: opts?.agentType ?? "chat_agent",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(
    `RELATE $identity->identity_agent->$agent SET added_at = time::now();`,
    { identity: identityRecord, agent: agentRecord },
  );

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now(), role = "agent";`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { agentId, identityId };
}
