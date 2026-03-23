/**
 * SurrealDB queries for credential_provider and connected_account CRUD.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { CredentialProviderRecord, ConnectedAccountRecord } from "./types";

/**
 * Check if a provider with the given name already exists in the workspace.
 */
export async function providerNameExists(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM credential_provider WHERE workspace = $ws AND name = $name LIMIT 1;`,
    { ws: workspaceRecord, name },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create a credential_provider record.
 */
export async function createProvider(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  content: Record<string, unknown>,
): Promise<CredentialProviderRecord> {
  const providerId = crypto.randomUUID();
  const providerRecord = new RecordId("credential_provider", providerId);

  const fullContent = {
    ...content,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  await surreal.query(`CREATE $provider CONTENT $content;`, {
    provider: providerRecord,
    content: fullContent,
  });

  return {
    id: providerRecord,
    ...fullContent,
  } as unknown as CredentialProviderRecord;
}

/**
 * List all credential_providers in a workspace.
 */
export async function listProviders(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<CredentialProviderRecord[]> {
  const results = await surreal.query<[CredentialProviderRecord[]]>(
    `SELECT * FROM credential_provider WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );
  return results[0] ?? [];
}

// ---------------------------------------------------------------------------
// Connected Account Queries
// ---------------------------------------------------------------------------

/**
 * Fetch a credential_provider by ID.
 */
export async function getProviderById(
  surreal: Surreal,
  providerId: string,
): Promise<CredentialProviderRecord | undefined> {
  const providerRecord = new RecordId("credential_provider", providerId);
  const results = await surreal.query<[CredentialProviderRecord[]]>(
    `SELECT * FROM $provider;`,
    { provider: providerRecord },
  );
  return (results[0] ?? [])[0];
}

/**
 * Check if an active connected_account already exists for identity + provider.
 */
export async function activeAccountExists(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  providerRecord: RecordId<"credential_provider", string>,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM connected_account WHERE identity = $identity AND provider = $provider AND status = "active" LIMIT 1;`,
    { identity: identityRecord, provider: providerRecord },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create a connected_account record with pre-encrypted credential fields.
 */
export async function createConnectedAccount(
  surreal: Surreal,
  content: Record<string, unknown>,
): Promise<ConnectedAccountRecord> {
  const accountId = crypto.randomUUID();
  const accountRecord = new RecordId("connected_account", accountId);

  const fullContent = {
    ...content,
    connected_at: new Date(),
    updated_at: new Date(),
  };

  await surreal.query(`CREATE $account CONTENT $content;`, {
    account: accountRecord,
    content: fullContent,
  });

  return {
    id: accountRecord,
    ...fullContent,
  } as unknown as ConnectedAccountRecord;
}

/**
 * List connected accounts for an identity in a workspace.
 */
export async function listConnectedAccounts(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ConnectedAccountRecord[]> {
  const results = await surreal.query<[ConnectedAccountRecord[]]>(
    `SELECT * FROM connected_account WHERE identity = $identity AND workspace = $ws ORDER BY connected_at DESC;`,
    { identity: identityRecord, ws: workspaceRecord },
  );
  return results[0] ?? [];
}

// ---------------------------------------------------------------------------
// Governance Queries
// ---------------------------------------------------------------------------

/** Row shape for governs_tool relation edges. */
export type GovernsPolicyRow = {
  readonly conditions?: string;
  readonly max_per_call?: number;
  readonly max_per_day?: number;
  readonly policyTitle: string;
  readonly policyStatus: string;
};

/**
 * Fetch all active governance policies for a tool by name.
 *
 * Joins governs_tool edges with their policy records, returning only
 * policies with status "active". Each row carries the edge conditions
 * and limits plus the policy title for trace/error messages.
 */
export async function fetchGovernancePolicies(
  surreal: Surreal,
  toolName: string,
): Promise<GovernsPolicyRow[]> {
  const results = await surreal.query<[GovernsPolicyRow[]]>(
    `SELECT
       conditions,
       max_per_call,
       max_per_day,
       in.title AS policyTitle,
       in.status AS policyStatus
     FROM governs_tool
     WHERE out.name = $toolName
       AND in.status = 'active';`,
    { toolName },
  );
  return results[0] ?? [];
}

/**
 * Count successful tool executions for today (UTC midnight to now).
 * Used for max_per_day enforcement on governs_tool edges.
 */
export async function countTodayToolExecutions(
  surreal: Surreal,
  toolName: string,
  workspaceId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM trace
     WHERE type = 'tool_call'
       AND tool_name = $toolName
       AND workspace = $ws
       AND output.outcome = 'success'
       AND created_at >= time::floor(time::now(), 1d)
     GROUP ALL;`,
    { toolName, ws: workspaceRecord },
  );

  return (results[0] ?? [])[0]?.count ?? 0;
}

/**
 * Count tool executions in the last hour for a specific identity + tool.
 * Used for can_use.max_calls_per_hour rate limit enforcement.
 */
export async function countHourlyToolExecutions(
  surreal: Surreal,
  toolName: string,
  workspaceId: string,
  identityId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  const results = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM trace
     WHERE type = 'tool_call'
       AND tool_name = $toolName
       AND workspace = $ws
       AND actor = $actor
       AND output.outcome = 'success'
       AND created_at >= time::now() - 1h
     GROUP ALL;`,
    { toolName, ws: workspaceRecord, actor: identityRecord },
  );

  return (results[0] ?? [])[0]?.count ?? 0;
}

/**
 * Revoke a connected_account: set status to "revoked" and hard-delete all
 * encrypted credential fields (set to NONE). Idempotent -- revoking an
 * already-revoked account succeeds without error.
 */
export async function revokeConnectedAccount(
  surreal: Surreal,
  accountRecord: RecordId<"connected_account", string>,
  identityRecord: RecordId<"identity", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ConnectedAccountRecord | undefined> {
  const results = await surreal.query<[ConnectedAccountRecord[]]>(
    `UPDATE $acct SET
       status = 'revoked',
       access_token_encrypted = NONE,
       refresh_token_encrypted = NONE,
       api_key_encrypted = NONE,
       basic_password_encrypted = NONE,
       bearer_token_encrypted = NONE,
       updated_at = time::now()
     WHERE identity = $identity AND workspace = $ws;`,
    { acct: accountRecord, identity: identityRecord, ws: workspaceRecord },
  );
  return (results[0] ?? [])[0];
}

// ---------------------------------------------------------------------------
// Tool Listing Queries
// ---------------------------------------------------------------------------

/** Row shape returned by listToolsWithCounts. */
export type ToolWithCountsRow = {
  readonly id: RecordId<"mcp_tool", string>;
  readonly name: string;
  readonly toolkit: string;
  readonly description: string;
  readonly risk_level: string;
  readonly status: string;
  readonly workspace: RecordId<"workspace", string>;
  readonly source_server?: RecordId<"mcp_server", string>;
  readonly grant_count: number;
  readonly governance_count: number;
  readonly created_at: Date;
};

/**
 * List all tools in a workspace with grant and governance counts.
 *
 * Uses SurrealDB subquery counts on can_use (grants) and governs_tool
 * (governance) relation edges.
 */
export async function listToolsWithCounts(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ToolWithCountsRow[]> {
  const results = await surreal.query<[ToolWithCountsRow[]]>(
    `SELECT
       id,
       name,
       toolkit,
       description,
       risk_level,
       status,
       workspace,
       source_server,
       count(SELECT id FROM can_use WHERE out = $parent.id) AS grant_count,
       count(SELECT id FROM governs_tool WHERE out = $parent.id) AS governance_count,
       created_at
     FROM mcp_tool
     WHERE workspace = $ws
     ORDER BY toolkit ASC, name ASC;`,
    { ws: workspaceRecord },
  );
  return results[0] ?? [];
}

// ---------------------------------------------------------------------------
// Tool Detail Query (batched)
// ---------------------------------------------------------------------------

/** Row shape for a single mcp_tool record. */
export type ToolDetailRow = {
  readonly id: RecordId<"mcp_tool", string>;
  readonly name: string;
  readonly toolkit: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
  readonly risk_level: string;
  readonly status: string;
  readonly workspace: RecordId<"workspace", string>;
  readonly source_server?: RecordId<"mcp_server", string>;
  readonly created_at: Date;
};

/** Row shape for a can_use grant edge with identity details. */
export type GrantDetailRow = {
  readonly identity_id: RecordId<"identity", string>;
  readonly identity_name: string;
  readonly max_calls_per_hour?: number;
  readonly granted_at: Date | string;
};

/** Row shape for a governs_tool edge with policy details. */
export type GovernancePolicyDetailRow = {
  readonly policy_title: string;
  readonly policy_status: string;
  readonly conditions?: string;
  readonly max_per_call?: number;
  readonly max_per_day?: number;
};

/**
 * Fetch tool detail with grants and governance policies in a single batched query.
 *
 * Returns undefined if the tool does not exist or does not belong to the workspace.
 */
export async function getToolDetail(
  surreal: Surreal,
  toolRecord: RecordId<"mcp_tool", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<
  | {
      tool: ToolDetailRow;
      grants: GrantDetailRow[];
      governancePolicies: GovernancePolicyDetailRow[];
    }
  | undefined
> {
  const results = await surreal.query<
    [ToolDetailRow[], GrantDetailRow[], GovernancePolicyDetailRow[]]
  >(
    `SELECT * FROM $tool WHERE workspace = $ws;
     SELECT in.id AS identity_id, in.name AS identity_name, max_calls_per_hour, granted_at FROM can_use WHERE out = $tool;
     SELECT in.title AS policy_title, in.status AS policy_status, conditions, max_per_call, max_per_day FROM governs_tool WHERE out = $tool;`,
    { tool: toolRecord, ws: workspaceRecord },
  );

  const toolRows = results[0] ?? [];
  if (toolRows.length === 0) {
    return undefined;
  }

  return {
    tool: toolRows[0],
    grants: results[1] ?? [],
    governancePolicies: results[2] ?? [],
  };
}

// ---------------------------------------------------------------------------
// Grant Management Queries
// ---------------------------------------------------------------------------

/**
 * Check if a can_use grant already exists between identity and tool.
 */
export async function grantExists(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  toolRecord: RecordId<"mcp_tool", string>,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM can_use WHERE in = $identity AND out = $tool LIMIT 1;`,
    { identity: identityRecord, tool: toolRecord },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Check if an identity record exists.
 */
export async function identityExists(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM $identity;`,
    { identity: identityRecord },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Check if an mcp_tool record exists in the given workspace.
 */
export async function toolExistsInWorkspace(
  surreal: Surreal,
  toolRecord: RecordId<"mcp_tool", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM $tool WHERE workspace = $ws LIMIT 1;`,
    { tool: toolRecord, ws: workspaceRecord },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create a can_use grant edge between identity and tool.
 * Uses RELATE for TYPE RELATION tables (per surrealdb.md).
 */
export async function createGrant(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  toolRecord: RecordId<"mcp_tool", string>,
  maxCallsPerHour?: number,
): Promise<void> {
  const setClause = maxCallsPerHour !== undefined
    ? `SET granted_at = time::now(), max_calls_per_hour = $maxCallsPerHour`
    : `SET granted_at = time::now()`;

  await surreal.query(
    `RELATE $identity->can_use->$tool ${setClause};`,
    { identity: identityRecord, tool: toolRecord, maxCallsPerHour },
  );
}

/**
 * List all grants (can_use edges) for a tool, with identity details.
 */
export async function listGrantsForTool(
  surreal: Surreal,
  toolRecord: RecordId<"mcp_tool", string>,
): Promise<GrantDetailRow[]> {
  const results = await surreal.query<[GrantDetailRow[]]>(
    `SELECT in.id AS identity_id, in.name AS identity_name, max_calls_per_hour, granted_at FROM can_use WHERE out = $tool ORDER BY granted_at DESC;`,
    { tool: toolRecord },
  );
  return results[0] ?? [];
}

/**
 * Fetch rate limit from can_use edge for identity + tool.
 */
export async function fetchCanUseRateLimit(
  surreal: Surreal,
  identityId: string,
  toolName: string,
): Promise<{ maxCallsPerHour?: number }> {
  const identityRecord = new RecordId("identity", identityId);

  const results = await surreal.query<[Array<{ max_calls_per_hour?: number }>]>(
    `SELECT max_calls_per_hour FROM can_use WHERE in = $identity AND out.name = $toolName LIMIT 1;`,
    { identity: identityRecord, toolName },
  );

  const row = (results[0] ?? [])[0];
  return { maxCallsPerHour: row?.max_calls_per_hour };
}
