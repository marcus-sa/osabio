/**
 * Agent Query Functions
 *
 * SurrealDB graph traversal, atomic creation transactions, and
 * atomic deletion transactions for the agent CRUD module.
 *
 * All functions take `surreal` as first parameter (dependency injection).
 * No module-level singletons or mutable state.
 */
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { HttpError } from "../http/errors";
import {
  generateProxyToken,
  hashProxyToken,
  computeExpiresAt,
  readProxyTokenTtlDays,
} from "../proxy/proxy-token-core";
import {
  AUTHORITY_ACTIONS,
  type AgentDetail,
  type AgentListItem,
  type AuthorityAction,
  type AuthorityPermission,
  type CreateAgentInput,
  type CreateAgentResult,
  type DeleteAgentResult,
  type SandboxConfig,
  type SessionSummary,
} from "./types";

// ---------------------------------------------------------------------------
// List agents
// ---------------------------------------------------------------------------

type ListAgentRow = {
  id: RecordId<"identity_agent", string>;
  agent_id: RecordId<"agent", string>;
  agent_name: string;
  agent_description?: string;
  agent_runtime: string;
  agent_model?: string;
  identity_id: RecordId<"identity", string>;
  agent_created_at: string | Date;
};

/**
 * List all agents in a workspace via graph traversal:
 * workspace <- member_of <- identity <- identity_agent -> agent
 */
export async function listAgents(
  surreal: Surreal,
  workspaceId: string,
): Promise<AgentListItem[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const [rows] = await surreal
    .query<[ListAgentRow[]]>(
      `SELECT
        id,
        out.id AS agent_id,
        out.name AS agent_name,
        out.description AS agent_description,
        out.runtime AS agent_runtime,
        out.model AS agent_model,
        in.id AS identity_id,
        out.created_at AS agent_created_at
      FROM identity_agent
      WHERE in IN (
        SELECT VALUE in FROM member_of WHERE out = $ws AND in.type = 'agent'
      )
      ORDER BY agent_created_at DESC;`,
      { ws: workspaceRecord },
    );

  return rows.map(toAgentListItem);
}

function toAgentListItem(row: ListAgentRow): AgentListItem {
  return {
    id: row.agent_id.id as string,
    name: row.agent_name,
    ...(row.agent_description ? { description: row.agent_description } : {}),
    runtime: row.agent_runtime as AgentListItem["runtime"],
    ...(row.agent_model ? { model: row.agent_model } : {}),
    identity_id: row.identity_id.id as string,
    created_at: toISOString(row.agent_created_at),
  };
}

// ---------------------------------------------------------------------------
// Check agent name availability
// ---------------------------------------------------------------------------

/**
 * Check if an agent name is available within a workspace.
 * Returns true if the name is not taken.
 */
export async function checkAgentName(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<boolean> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const [rows] = await surreal
    .query<[Array<{ agent_name: string }>]>(
      `SELECT out.name AS agent_name
      FROM identity_agent
      WHERE in IN (
        SELECT VALUE in FROM member_of WHERE out = $ws AND in.type = 'agent'
      )
      AND out.name = $name
      LIMIT 1;`,
      { ws: workspaceRecord, name },
    );

  return rows.length === 0;
}

// ---------------------------------------------------------------------------
// Create agent (atomic transaction)
// ---------------------------------------------------------------------------

/**
 * Create an agent with identity, membership, authority scopes, and
 * optional proxy token in a single atomic transaction.
 *
 * Steps:
 * 1. Validate name uniqueness within workspace
 * 2. CREATE agent record
 * 3. CREATE identity record
 * 4. RELATE identity -> identity_agent -> agent
 * 5. RELATE identity -> member_of -> workspace
 * 6. For each of 11 actions: RELATE identity -> authorized_to -> authority_scope
 * 7. For external agents: generate and store proxy token
 */
export async function createAgentTransaction(
  surreal: Surreal,
  workspaceId: string,
  input: CreateAgentInput,
  now: Date,
): Promise<CreateAgentResult> {
  // Pre-validate name uniqueness
  const nameAvailable = await checkAgentName(surreal, workspaceId, input.name);
  if (!nameAvailable) {
    throw new HttpError(409, `Agent name '${input.name}' is already taken in this workspace`);
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const agentId = randomUUID();
  const identityId = randomUUID();
  const agentRecord = new RecordId("agent", agentId);
  const identityRecord = new RecordId("identity", identityId);

  // Build permission map from input, defaulting unconfigured actions to "propose"
  const permissionMap = buildPermissionMap(input.authority_scopes);

  // Look up all authority_scope records for our actions to get the OUT targets
  const [scopeRows] = await surreal
    .query<[Array<{ id: RecordId<"authority_scope", string>; action: string }>]>(
      `SELECT id, action FROM authority_scope
       WHERE action IN $actions
       AND workspace IS NONE;`,
      { actions: [...AUTHORITY_ACTIONS] },
    );

  const scopeByAction = new Map(
    scopeRows.map((row) => [row.action, row.id]),
  );

  // Build the transaction SQL
  const statements: string[] = [];
  const bindings: Record<string, unknown> = {
    agentRecord,
    identityRecord,
    wsRecord: workspaceRecord,
    agentName: input.name,
    agentRuntime: input.runtime,
    now,
  };

  // Step 2: CREATE agent
  statements.push(
    `CREATE $agentRecord CONTENT {
      runtime: $agentRuntime,
      name: $agentName,
      ${input.description ? "description: $agentDescription," : ""}
      ${input.model ? "model: $agentModel," : ""}
      managed_by: $identityRecord,
      created_at: $now
      ${input.sandbox_config ? ", sandbox_config: $sandboxConfig" : ""}
    };`,
  );

  if (input.description) bindings.agentDescription = input.description;
  if (input.model) bindings.agentModel = input.model;
  if (input.sandbox_config) bindings.sandboxConfig = input.sandbox_config;

  // Step 3: CREATE identity
  statements.push(
    `CREATE $identityRecord CONTENT {
      name: $agentName,
      type: 'agent',
      role: 'custom',
      identity_status: 'active',
      workspace: $wsRecord,
      created_at: $now
    };`,
  );

  // Step 4: RELATE identity -> identity_agent -> agent
  const identityAgentId = randomUUID();
  bindings.identityAgentRecord = new RecordId("identity_agent", identityAgentId);
  statements.push(
    `RELATE $identityRecord -> identity_agent -> $agentRecord
     CONTENT { added_at: $now };`,
  );

  // Step 5: RELATE identity -> member_of -> workspace
  statements.push(
    `RELATE $identityRecord -> member_of -> $wsRecord
     CONTENT { role: 'agent', added_at: $now };`,
  );

  // Step 6: RELATE identity -> authorized_to -> authority_scope for each action
  for (const action of AUTHORITY_ACTIONS) {
    const scopeRecord = scopeByAction.get(action);
    if (!scopeRecord) continue; // Skip if no global scope exists for this action

    const permission = permissionMap.get(action) ?? "propose";
    const bindKey = `scope_${action}`;
    const permKey = `perm_${action}`;
    bindings[bindKey] = scopeRecord;
    bindings[permKey] = permission;

    statements.push(
      `RELATE $identityRecord -> authorized_to -> $${bindKey}
       CONTENT { permission: $${permKey}, created_at: $now };`,
    );
  }

  // Step 7: For external agents, generate proxy token
  let plainToken: string | undefined;
  if (input.runtime === "external") {
    plainToken = generateProxyToken();
    const tokenHash = hashProxyToken(plainToken);
    const ttlDays = readProxyTokenTtlDays();
    const expiresAt = computeExpiresAt(ttlDays, now);
    const proxyTokenId = randomUUID();

    bindings.proxyTokenRecord = new RecordId("proxy_token", proxyTokenId);
    bindings.tokenHash = tokenHash;
    bindings.expiresAt = expiresAt;

    statements.push(
      `CREATE $proxyTokenRecord CONTENT {
        token_hash: $tokenHash,
        workspace: $wsRecord,
        identity: $identityRecord,
        expires_at: $expiresAt,
        created_at: $now,
        revoked: false
      };`,
    );
  }

  // Execute all statements in a single transaction
  const transactionSql = `BEGIN TRANSACTION;\n${statements.join("\n")}\nCOMMIT TRANSACTION;`;
  await surreal.query(transactionSql, bindings);

  const agentListItem: AgentListItem = {
    id: agentId,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    runtime: input.runtime,
    ...(input.model ? { model: input.model } : {}),
    identity_id: identityId,
    created_at: now.toISOString(),
  };

  return {
    agent: agentListItem,
    ...(plainToken ? { proxy_token: plainToken } : {}),
  };
}

function buildPermissionMap(
  scopes?: Array<{ action: AuthorityAction; permission: AuthorityPermission }>,
): Map<AuthorityAction, AuthorityPermission> {
  const map = new Map<AuthorityAction, AuthorityPermission>();
  if (!scopes) return map;
  for (const scope of scopes) {
    map.set(scope.action, scope.permission);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Get agent detail
// ---------------------------------------------------------------------------

type AgentDetailRow = {
  id: RecordId<"agent", string>;
  name: string;
  description?: string;
  runtime: string;
  model?: string;
  sandbox_config?: SandboxConfig;
  created_at: string | Date;
};

type IdentityRow = {
  id: RecordId<"identity", string>;
  name: string;
  type: string;
  role?: string;
};

type AuthorizedToRow = {
  action: string;
  permission: string;
};

type SessionRow = {
  id: RecordId<"agent_session", string>;
  started_at: string | Date;
  ended_at?: string | Date;
  orchestrator_status?: string;
  summary?: string;
};

/**
 * Get full agent detail including identity, authority scopes, and
 * recent workspace sessions.
 */
export async function getAgentDetail(
  surreal: Surreal,
  workspaceId: string,
  agentId: string,
): Promise<AgentDetail | undefined> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const agentRecord = new RecordId("agent", agentId);

  // Query agent, identity, authorized_to edges, and sessions in one round-trip
  const results = await surreal
    .query<[AgentDetailRow[], IdentityRow[], AuthorizedToRow[], SessionRow[]]>(
      `SELECT id, name, description, runtime, model, sandbox_config, created_at
       FROM $agent;

       SELECT id, name, type, role
       FROM identity
       WHERE id IN (
         SELECT VALUE in FROM identity_agent WHERE out = $agent
       )
       AND workspace = $ws
       LIMIT 1;

       SELECT out.action AS action, permission
       FROM authorized_to
       WHERE in IN (
         SELECT VALUE in FROM identity_agent WHERE out = $agent
       )
       ORDER BY action ASC;

       SELECT id, started_at, ended_at, orchestrator_status, summary
       FROM agent_session
       WHERE workspace = $ws
       ORDER BY started_at DESC
       LIMIT 20;`,
      { agent: agentRecord, ws: workspaceRecord },
    );

  const [agentRows, identityRows, authorizedToRows, sessionRows] = results;

  if (agentRows.length === 0 || identityRows.length === 0) {
    return undefined;
  }

  const agentRow = agentRows[0];
  const identityRow = identityRows[0];

  const agentListItem: AgentDetail["agent"] = {
    id: agentRow.id.id as string,
    name: agentRow.name,
    ...(agentRow.description ? { description: agentRow.description } : {}),
    runtime: agentRow.runtime as AgentListItem["runtime"],
    ...(agentRow.model ? { model: agentRow.model } : {}),
    identity_id: identityRow.id.id as string,
    created_at: toISOString(agentRow.created_at),
    ...(agentRow.sandbox_config ? { sandbox_config: agentRow.sandbox_config } : {}),
  };

  return {
    agent: agentListItem,
    identity: {
      id: identityRow.id.id as string,
      name: identityRow.name,
      type: identityRow.type,
      ...(identityRow.role ? { role: identityRow.role } : {}),
    },
    authority_scopes: authorizedToRows.map((row) => ({
      action: row.action,
      permission: row.permission,
    })),
    sessions: sessionRows.map(toSessionSummary),
  };
}

function toSessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id.id as string,
    started_at: toISOString(row.started_at),
    ...(row.ended_at ? { ended_at: toISOString(row.ended_at) } : {}),
    ...(row.orchestrator_status ? { orchestrator_status: row.orchestrator_status } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
  };
}

// ---------------------------------------------------------------------------
// Delete agent (atomic transaction)
// ---------------------------------------------------------------------------

/**
 * Delete an agent and all associated records atomically.
 *
 * Validates:
 * - Agent exists in workspace
 * - Agent is not a brain-managed agent
 * - Confirmation name matches agent name
 *
 * Deletes:
 * 1. authorized_to edges from identity
 * 2. proxy_token records for identity
 * 3. member_of edges from identity to workspace
 * 4. identity_agent edges to agent
 * 5. identity record
 * 6. agent record
 */
export async function deleteAgentTransaction(
  surreal: Surreal,
  workspaceId: string,
  agentId: string,
  confirmName: string,
): Promise<DeleteAgentResult> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const agentRecord = new RecordId("agent", agentId);

  // Validate agent exists and fetch identity
  const [agentRows, identityRows] = await surreal
    .query<[
      Array<{ id: RecordId; name: string; runtime: string }>,
      Array<{ id: RecordId<"identity", string> }>,
    ]>(
      `SELECT id, name, runtime FROM $agent;

       SELECT VALUE in FROM identity_agent
       WHERE out = $agent
       AND in IN (
         SELECT VALUE in FROM member_of WHERE out = $ws AND in.type = 'agent'
       )
       LIMIT 1;`,
      { agent: agentRecord, ws: workspaceRecord },
    );

  if (agentRows.length === 0) {
    throw new HttpError(404, "Agent not found");
  }

  const agent = agentRows[0];

  if (agent.runtime === "brain") {
    throw new HttpError(403, "Cannot delete brain-managed agents");
  }

  if (agent.name !== confirmName) {
    throw new HttpError(
      400,
      `Confirmation name '${confirmName}' does not match agent name '${agent.name}'`,
    );
  }

  if (identityRows.length === 0) {
    throw new HttpError(404, "Agent identity not found in workspace");
  }

  const identityRecord = identityRows[0] as unknown as RecordId<"identity", string>;

  // Execute deletion in a single transaction
  await surreal.query(
    `BEGIN TRANSACTION;
     DELETE FROM authorized_to WHERE in = $identity;
     DELETE FROM proxy_token WHERE identity = $identity;
     DELETE FROM member_of WHERE in = $identity AND out = $ws;
     DELETE FROM identity_agent WHERE out = $agent;
     DELETE $identity;
     DELETE $agent;
     COMMIT TRANSACTION;`,
    {
      identity: identityRecord,
      agent: agentRecord,
      ws: workspaceRecord,
    },
  );

  return {
    deleted: true,
    sessions_aborted: 0, // Deferred to R2
  };
}

// ---------------------------------------------------------------------------
// Lookup agent in workspace
// ---------------------------------------------------------------------------

type AgentLookupRow = {
  agent_name: string;
  agent_runtime: string;
};

/**
 * Look up an agent by ID and verify it belongs to the given workspace.
 *
 * Uses graph traversal: workspace <- member_of <- identity <- identity_agent -> agent
 * Returns `{ name, runtime }` if found, throws HttpError(404) otherwise.
 */
export async function lookupAgentInWorkspace(
  surreal: Surreal,
  agentId: string,
  workspaceId: string,
): Promise<{ name: string; runtime: string }> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const agentRecord = new RecordId("agent", agentId);

  const [rows] = await surreal.query<[AgentLookupRow[]]>(
    `SELECT out.name AS agent_name, out.runtime AS agent_runtime
     FROM identity_agent
     WHERE out = $agent
     AND in IN (
       SELECT VALUE in FROM member_of WHERE out = $ws AND in.type = 'agent'
     )
     LIMIT 1;`,
    { agent: agentRecord, ws: workspaceRecord },
  );

  if (rows.length === 0) {
    throw new HttpError(404, `Agent ${agentId} not found in workspace ${workspaceId}`);
  }

  return { name: rows[0].agent_name, runtime: rows[0].agent_runtime };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISOString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
