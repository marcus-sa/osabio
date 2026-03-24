/**
 * HTTP routes for tool access grant management (Access tab).
 *
 * POST /api/workspaces/:workspaceId/tools/:toolId/grants  -- create grant
 * GET  /api/workspaces/:workspaceId/tools/:toolId/grants  -- list grants
 */
import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  grantExists,
  identityExists,
  toolExistsInWorkspace,
  createGrant,
  listGrantsForTool,
  getPolicyById,
  createGovernanceEdge,
  type GrantDetailRow,
} from "./queries";
import type { GrantDetail } from "./types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Response mapping -- DB record to API shape
// ---------------------------------------------------------------------------

function toGrantDetail(row: GrantDetailRow): GrantDetail {
  return {
    identity_id: row.identity_id.id as string,
    identity_name: row.identity_name,
    max_calls_per_hour: row.max_calls_per_hour,
    granted_at: row.granted_at instanceof Date
      ? row.granted_at.toISOString()
      : String(row.granted_at),
  };
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

type CreateGrantInput = {
  identity_id: string;
  max_calls_per_hour?: number;
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createGrantRouteHandlers(deps: ServerDependencies) {
  async function handleCreateGrant(
    workspaceId: string,
    toolId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("grant.create", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    let body: CreateGrantInput;
    try {
      body = await request.json() as CreateGrantInput;
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    // Validate identity_id is present
    if (!body.identity_id || typeof body.identity_id !== "string") {
      return jsonError("identity_id is required", 400);
    }

    const identityRecord = new RecordId("identity", body.identity_id);
    const toolRecord = new RecordId("mcp_tool", toolId);

    // Validate tool exists in workspace
    const toolFound = await toolExistsInWorkspace(deps.surreal, toolRecord, workspaceRecord);
    if (!toolFound) {
      return jsonError("Tool not found", 404);
    }

    // Validate identity exists
    const identityFound = await identityExists(deps.surreal, identityRecord);
    if (!identityFound) {
      return jsonError("Identity not found", 404);
    }

    // Check for duplicate grant
    const duplicate = await grantExists(deps.surreal, identityRecord, toolRecord);
    if (duplicate) {
      return jsonError("Grant already exists for this identity and tool", 409);
    }

    // Create the grant
    await createGrant(deps.surreal, identityRecord, toolRecord, body.max_calls_per_hour);

    return jsonResponse({ created: true }, 201);
  }

  async function handleListGrants(
    workspaceId: string,
    toolId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("grant.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const toolRecord = new RecordId("mcp_tool", toolId);

    // Validate tool exists in workspace
    const toolFound = await toolExistsInWorkspace(deps.surreal, toolRecord, workspaceRecord);
    if (!toolFound) {
      return jsonError("Tool not found", 404);
    }

    const rows = await listGrantsForTool(deps.surreal, toolRecord);
    const grants = rows.map(toGrantDetail);

    return jsonResponse({ grants }, 200);
  }

  async function handleAttachGovernance(
    workspaceId: string,
    toolId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("governance.attach", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    let body: { policy_id?: string; conditions?: string; max_per_call?: number; max_per_day?: number };
    try {
      body = await request.json() as typeof body;
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    // Validate policy_id is present
    if (!body.policy_id || typeof body.policy_id !== "string") {
      return jsonError("policy_id is required", 400);
    }

    const toolRecord = new RecordId("mcp_tool", toolId);
    const policyRecord = new RecordId("policy", body.policy_id);

    // Validate tool exists in workspace
    const toolFound = await toolExistsInWorkspace(deps.surreal, toolRecord, workspaceRecord);
    if (!toolFound) {
      return jsonError("Tool not found", 404);
    }

    // Validate policy exists
    const policy = await getPolicyById(deps.surreal, policyRecord);
    if (!policy) {
      return jsonError("Policy not found", 404);
    }

    // Validate policy is active (reject deprecated)
    if (policy.status !== "active") {
      return jsonError("Policy must be active to attach governance", 400);
    }

    // Create the governs_tool edge
    await createGovernanceEdge(deps.surreal, policyRecord, toolRecord, {
      conditions: body.conditions,
      maxPerCall: body.max_per_call,
      maxPerDay: body.max_per_day,
    });

    return jsonResponse({ created: true }, 201);
  }

  /**
   * GET /api/workspaces/:workspaceId/identities
   *
   * List identities in a workspace (for grant dialog identity picker).
   */
  async function handleListIdentities(
    workspaceId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("identities.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const [rows] = await deps.surreal.query<[Array<{ id: RecordId; name: string; type: string }>]>(
      `SELECT id, name, type FROM identity WHERE workspace = $ws ORDER BY name ASC;`,
      { ws: workspaceRecord },
    );

    const identities = (rows ?? []).map((row) => ({
      id: row.id.id as string,
      name: row.name,
      type: row.type,
    }));

    return jsonResponse({ identities }, 200);
  }

  return { handleCreateGrant, handleListGrants, handleAttachGovernance, handleListIdentities };
}
