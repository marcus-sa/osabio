import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  getProjectGraphView,
  getFocusedGraphView,
  getWorkspaceGraphOverview,
  parseRecordIdString,
  type GraphEntityTable,
} from "./queries";
import { transformToReagraph } from "./transform";

export function createGraphRouteHandler(
  deps: ServerDependencies,
): (workspaceId: string, url: URL) => Promise<Response> {
  return (workspaceId: string, url: URL) => handleGraphRoute(deps, workspaceId, url);
}

async function handleGraphRoute(
  deps: ServerDependencies,
  workspaceId: string,
  url: URL,
): Promise<Response> {
  let workspaceRecord: RecordId<"workspace", string>;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    logError("graph.route.workspace_resolve.failed", "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  const projectParam = url.searchParams.get("project")?.trim();
  const centerParam = url.searchParams.get("center")?.trim();
  const depthParam = url.searchParams.get("depth")?.trim();
  const depth = depthParam ? Math.max(1, Math.min(3, Number(depthParam) || 2)) : 2;

  try {
    if (centerParam) {
      const entityTables: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question", "suggestion", "policy", "intent", "objective", "behavior"];
      const centerRecord = parseRecordIdString(centerParam, entityTables);
      const raw = await getFocusedGraphView({
        surreal: deps.surreal,
        workspaceRecord,
        centerEntityRecord: centerRecord,
        depth,
      });
      const result = transformToReagraph(raw);
      logInfo("graph.route.focused", "Focused graph view served", {
        workspaceId,
        center: centerParam,
        depth,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
      });
      return jsonResponse(result, 200);
    }

    if (projectParam) {
      const projectRecord = new RecordId("project", projectParam);
      const raw = await getProjectGraphView({
        surreal: deps.surreal,
        workspaceRecord,
        projectRecord,
      });
      const result = transformToReagraph(raw);
      logInfo("graph.route.project", "Project graph view served", {
        workspaceId,
        project: projectParam,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
      });
      return jsonResponse(result, 200);
    }

    const raw = await getWorkspaceGraphOverview({
      surreal: deps.surreal,
      workspaceRecord,
    });
    const result = transformToReagraph(raw);
    logInfo("graph.route.overview", "Workspace graph overview served", {
      workspaceId,
      nodeCount: result.nodes.length,
      edgeCount: result.edges.length,
    });
    return jsonResponse(result, 200);
  } catch (error) {
    logError("graph.route.failed", "Graph route failed", error, {
      workspaceId,
      project: projectParam,
      center: centerParam,
    });
    const message = error instanceof Error ? error.message : "graph query failed";
    return jsonError(message, 500);
  }
}
