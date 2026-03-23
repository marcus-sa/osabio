/**
 * HTTP routes for tool browsing (Tools tab).
 *
 * GET /api/workspaces/:workspaceId/tools  -- list tools with grant/governance counts
 */
import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  listToolsWithCounts,
  getToolDetail,
  type ToolWithCountsRow,
  type GrantDetailRow,
  type GovernancePolicyDetailRow,
} from "./queries";
import type { ToolListItem, ToolDetail, GrantDetail, GovernancePolicyDetail } from "./types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Response mapping -- DB record to API shape
// ---------------------------------------------------------------------------

function toToolListItem(row: ToolWithCountsRow): ToolListItem {
  const item: ToolListItem = {
    id: row.id.id as string,
    name: row.name,
    toolkit: row.toolkit,
    description: row.description,
    risk_level: row.risk_level as ToolListItem["risk_level"],
    status: row.status as ToolListItem["status"],
    grant_count: row.grant_count,
    governance_count: row.governance_count,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };

  return item;
}

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

function toGovernancePolicyDetail(row: GovernancePolicyDetailRow): GovernancePolicyDetail {
  return {
    policy_title: row.policy_title,
    policy_status: row.policy_status,
    conditions: row.conditions,
    max_per_call: row.max_per_call,
    max_per_day: row.max_per_day,
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createToolRouteHandlers(deps: ServerDependencies) {
  async function handleListTools(
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
      log.error("tool.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const rows = await listToolsWithCounts(deps.surreal, workspaceRecord);
    const tools = rows.map(toToolListItem);
    return jsonResponse({ tools }, 200);
  }

  async function handleGetToolDetail(
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
      log.error("tool.detail", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const toolRecord = new RecordId("mcp_tool", toolId);
    const result = await getToolDetail(deps.surreal, toolRecord, workspaceRecord);

    if (!result) {
      return jsonError("Tool not found", 404);
    }

    const { tool, grants, governancePolicies } = result;

    const grantCount = grants.length;
    const governanceCount = governancePolicies.length;

    const detail: ToolDetail = {
      id: tool.id.id as string,
      name: tool.name,
      toolkit: tool.toolkit,
      description: tool.description,
      risk_level: tool.risk_level as ToolListItem["risk_level"],
      status: tool.status as ToolListItem["status"],
      grant_count: grantCount,
      governance_count: governanceCount,
      created_at: tool.created_at instanceof Date
        ? tool.created_at.toISOString()
        : String(tool.created_at),
      input_schema: tool.input_schema,
      grants: grants.map(toGrantDetail),
      governance_policies: governancePolicies.map(toGovernancePolicyDetail),
    };

    return jsonResponse(detail, 200);
  }

  return { handleListTools, handleGetToolDetail };
}
