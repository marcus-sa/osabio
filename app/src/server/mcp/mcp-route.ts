import { RecordId } from "surrealdb";
import { jsonError, jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { buildProjectContext } from "./context-builder";
import type { ServerDependencies } from "../runtime/types";

type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
};

type ProjectRow = {
  id: RecordId<"project", string>;
  name: string;
};

/**
 * Creates MCP route handler.
 *
 * Endpoints:
 *   POST /api/mcp/:workspaceId/context
 *     Body: { project_id: string, task_id?: string, since?: string }
 *     Returns: ContextPacket
 *
 *   GET /api/mcp/:workspaceId/projects
 *     Returns: { projects: { id, name }[] }
 */
export function createMcpRouteHandlers(deps: ServerDependencies) {
  const { surreal } = deps;

  async function handleGetContext(workspaceId: string, request: Request): Promise<Response> {
    // Validate workspace
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      return jsonError("workspace not found", 404);
    }

    // Parse body
    let body: { project_id: string; task_id?: string; since?: string };
    try {
      body = await request.json();
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    if (!body.project_id || typeof body.project_id !== "string") {
      return jsonError("project_id is required", 400);
    }

    // Validate project belongs to workspace
    const projectRecord = new RecordId("project", body.project_id);
    const project = await surreal.select<ProjectRow>(projectRecord);
    if (!project) {
      return jsonError("project not found", 404);
    }

    try {
      const contextPacket = await buildProjectContext({
        surreal,
        workspaceRecord,
        workspaceName: workspace.name,
        projectRecord,
        taskId: body.task_id,
        since: body.since,
      });

      logInfo("mcp.context.built", "MCP context packet assembled", {
        workspaceId,
        projectId: body.project_id,
        taskId: body.task_id,
        decisionsCount:
          contextPacket.decisions.confirmed.length +
          contextPacket.decisions.provisional.length +
          contextPacket.decisions.contested.length,
        tasksCount: contextPacket.active_tasks.length,
        questionsCount: contextPacket.open_questions.length,
        observationsCount: contextPacket.observations.length,
      });

      return jsonResponse(contextPacket, 200);
    } catch (error) {
      logError("mcp.context.failed", "Failed to build MCP context", error);
      return jsonError("failed to build context", 500);
    }
  }

  async function handleListProjects(workspaceId: string): Promise<Response> {
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      return jsonError("workspace not found", 404);
    }

    const [projectRows] = await surreal
      .query<[ProjectRow[]]>(
        "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[ProjectRow[]]>();

    const projects = projectRows.map((p) => ({
      id: p.id.id as string,
      name: p.name,
    }));

    return jsonResponse({ workspace: { id: workspaceId, name: workspace.name }, projects }, 200);
  }

  return {
    handleGetContext,
    handleListProjects,
  };
}
