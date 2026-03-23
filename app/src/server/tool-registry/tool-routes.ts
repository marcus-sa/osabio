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
import { listToolsWithCounts, type ToolWithCountsRow } from "./queries";
import type { ToolListItem } from "./types";
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

  return { handleListTools };
}
