import { RecordId } from "surrealdb";
import { generateObject } from "ai";
import { z } from "zod";
import { jsonError, jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { buildProjectContext } from "./context-builder";
import { authenticateMcpRequest, type McpAuthResult } from "./auth";
import { generateApiKey, hashApiKey } from "./api-key";
import {
  listProjectDecisions,
  getTaskDependencyTree,
  listProjectConstraints,
  listRecentChanges,
  createSubtask,
  updateTaskStatus,
  logImplementationNote,
  createAgentSession,
  endAgentSession,
  logCommit,
} from "./mcp-queries";
import { createObservation } from "../observation/queries";
import { OBSERVATION_TYPES, type ObservationType, type ObservationSeverity } from "../../shared/contracts";
import {
  createDecisionRecord,
  createQuestionRecord,
  getEntityDetail,
  parseRecordIdString,
  resolveWorkspaceProjectRecord,
  resolveWorkspaceFeatureRecord,
  listDecisionConstraintCandidates,
  searchEntitiesByEmbedding,
  isEntityInWorkspace,
  type GraphEntityTable,
} from "../graph/queries";
import { createEmbeddingVector } from "../graph/embeddings";
import type { ServerDependencies } from "../runtime/types";
import { requireRawId } from "./id-format";

type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
  api_key_hash?: string;
};

type ProjectRow = {
  id: RecordId<"project", string>;
  name: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError("invalid JSON body", 400);
  }
}

const ENTITY_TABLES: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question", "observation"];

function normalizeTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2),
  );
}

function hasTokenOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createMcpRouteHandlers(deps: ServerDependencies) {
  const { surreal, config, extractionModel } = deps;

  // ---- Auth helper: returns McpAuthResult or error Response ----
  async function requireAuth(request: Request, workspaceId: string): Promise<McpAuthResult | Response> {
    return authenticateMcpRequest(request, workspaceId, surreal);
  }

  // ---- Workspace helper (no auth - for legacy/unauthenticated routes) ----
  async function resolveWorkspaceById(workspaceId: string): Promise<{ workspaceRecord: RecordId<"workspace", string>; workspace: WorkspaceRow } | Response> {
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) return jsonError("workspace not found", 404);
    return { workspaceRecord, workspace };
  }

  async function requireScopedRecord(record: RecordId<string, string>, workspaceRecord: RecordId<"workspace", string>, label: string): Promise<Response | undefined> {
    if (record.table.name === "agent_session") {
      const session = await surreal.select<{ workspace: RecordId<"workspace", string> }>(record as RecordId<"agent_session", string>);
      if (!session) {
        return jsonError(`${label} not found`, 404);
      }
      if ((session.workspace.id as string) !== (workspaceRecord.id as string)) {
        return jsonError(`${label} is outside workspace scope`, 404);
      }
      return undefined;
    }

    const scoped = await isEntityInWorkspace(surreal, workspaceRecord, record as RecordId<GraphEntityTable, string>);
    if (!scoped) {
      return jsonError(`${label} is outside workspace scope`, 404);
    }
    return undefined;
  }

  // =========================================================================
  // Setup
  // =========================================================================

  /** POST /api/mcp/:workspaceId/auth/init — Generate API key */
  async function handleAuthInit(workspaceId: string): Promise<Response> {
    const result = await resolveWorkspaceById(workspaceId);
    if (result instanceof Response) return result;

    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    await surreal.update(result.workspaceRecord).merge({ api_key_hash: hash, updated_at: new Date() });

    logInfo("mcp.auth.init", "API key generated for workspace", { workspaceId });

    return jsonResponse({ api_key: apiKey, workspace: { id: workspaceId, name: result.workspace.name } }, 200);
  }

  /** GET /api/mcp/:workspaceId/projects — List workspace projects */
  async function handleListProjects(workspaceId: string): Promise<Response> {
    const result = await resolveWorkspaceById(workspaceId);
    if (result instanceof Response) return result;

    const [projectRows] = await surreal
      .query<[ProjectRow[]]>(
        "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: result.workspaceRecord },
      )
      .collect<[ProjectRow[]]>();

    return jsonResponse({
      workspace: { id: workspaceId, name: result.workspace.name },
      projects: projectRows.map((p) => ({ id: p.id.id as string, name: p.name })),
    }, 200);
  }

  // =========================================================================
  // Tier 1 — Read
  // =========================================================================

  /** POST /api/mcp/:workspaceId/context — Get project context (broad or task-scoped) */
  async function handleGetContext(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ project_id: string; task_id?: string; since?: string; session_id?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.project_id) return jsonError("project_id is required", 400);
    let projectId: string;
    let taskId: string | undefined;
    let sessionId: string | undefined;
    try {
      projectId = requireRawId(body.project_id, "project_id");
      taskId = body.task_id ? requireRawId(body.task_id, "task_id") : undefined;
      sessionId = body.session_id ? requireRawId(body.session_id, "session_id") : undefined;
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid id format", 400);
    }

    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;
    if (taskId) {
      const scopedTaskError = await requireScopedRecord(new RecordId("task", taskId), auth.workspaceRecord, "task");
      if (scopedTaskError) return scopedTaskError;
    }
    const project = await surreal.select<ProjectRow>(projectRecord);
    if (!project) return jsonError("project not found", 404);

    try {
      const contextPacket = await buildProjectContext({
        surreal,
        workspaceRecord: auth.workspaceRecord,
        workspaceName: auth.workspaceName,
        projectRecord,
        ...(taskId ? { taskId } : {}),
        since: body.since,
        ...(sessionId ? { excludeSessionId: sessionId } : {}),
      });

      logInfo("mcp.context.built", "MCP context packet assembled", {
        workspaceId,
        projectId,
        taskId,
        decisionsCount:
          contextPacket.decisions.confirmed.length +
          contextPacket.decisions.provisional.length +
          contextPacket.decisions.contested.length,
        tasksCount: contextPacket.active_tasks.length,
      });

      return jsonResponse(contextPacket, 200);
    } catch (error) {
      logError("mcp.context.failed", "Failed to build MCP context", error);
      return jsonError("failed to build context", 500);
    }
  }

  /** POST /api/mcp/:workspaceId/decisions — Active decisions by project/area */
  async function handleGetDecisions(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ project_id: string; area?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.project_id) return jsonError("project_id is required", 400);
    let projectId: string;
    try {
      projectId = requireRawId(body.project_id, "project_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid project_id", 400);
    }
    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;
    const decisions = await listProjectDecisions({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      projectRecord,
      area: body.area,
    });

    return jsonResponse(decisions, 200);
  }

  /** POST /api/mcp/:workspaceId/tasks/dependencies — Task dependency tree */
  async function handleGetTaskDependencies(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ task_id: string }>(request);
    if (body instanceof Response) return body;
    if (!body.task_id) return jsonError("task_id is required", 400);
    let taskId: string;
    try {
      taskId = requireRawId(body.task_id, "task_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid task_id", 400);
    }

    const taskRecord = new RecordId("task", taskId);
    const scopedTaskError = await requireScopedRecord(taskRecord, auth.workspaceRecord, "task");
    if (scopedTaskError) return scopedTaskError;
    const tree = await getTaskDependencyTree({ surreal, workspaceRecord: auth.workspaceRecord, taskRecord });

    return jsonResponse(tree, 200);
  }

  /** POST /api/mcp/:workspaceId/constraints — Architecture constraints */
  async function handleGetConstraints(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ project_id: string; area?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.project_id) return jsonError("project_id is required", 400);
    let projectId: string;
    try {
      projectId = requireRawId(body.project_id, "project_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid project_id", 400);
    }
    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;
    const constraints = await listProjectConstraints({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      projectRecord,
      area: body.area,
    });

    return jsonResponse({ constraints }, 200);
  }

  /** POST /api/mcp/:workspaceId/changes — Recent changes since timestamp */
  async function handleGetChanges(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ project_id?: string; since: string }>(request);
    if (body instanceof Response) return body;
    if (!body.since) return jsonError("since is required", 400);

    let projectRecord: RecordId<"project", string> | undefined;
    if (body.project_id) {
      let projectId: string;
      try {
        projectId = requireRawId(body.project_id, "project_id");
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "invalid project_id", 400);
      }
      const record = new RecordId("project", projectId);
      const scopedProjectError = await requireScopedRecord(record, auth.workspaceRecord, "project");
      if (scopedProjectError) return scopedProjectError;
      projectRecord = record;
    }

    const changes = await listRecentChanges({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      projectRecord,
      since: body.since,
    });

    return jsonResponse({ changes }, 200);
  }

  /** GET /api/mcp/:workspaceId/entities/:entityId — Entity detail */
  async function handleGetEntityDetail(workspaceId: string, entityId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    try {
      const entityRecord = parseRecordIdString(entityId, ENTITY_TABLES);
      const detail = await getEntityDetail({
        surreal,
        workspaceRecord: auth.workspaceRecord,
        entityRecord,
      });

      return jsonResponse(detail, 200);
    } catch {
      return jsonError(`entity not found: ${entityId}`, 404);
    }
  }

  // =========================================================================
  // Tier 2 — Reason
  // =========================================================================

  /** POST /api/mcp/:workspaceId/decisions/resolve — Infer decision from graph */
  async function handleResolveDecision(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      question: string;
      options?: string[];
      context?: { project?: string; feature?: string };
    }>(request);
    if (body instanceof Response) return body;
    if (!body.question) return jsonError("question is required", 400);

    // Embed the question and search for related decisions
    const queryEmbedding = await createEmbeddingVector(
      deps.embeddingModel,
      body.question,
      config.embeddingDimension,
    );

    if (!queryEmbedding) {
      return jsonResponse({
        decision: undefined,
        confidence: 0,
        status: "unresolved",
        rationale: "Could not create embedding for question",
        sources: [],
      }, 200);
    }

    const projectRecord = body.context?.project
      ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: auth.workspaceRecord, projectInput: body.context.project })
      : undefined;

    const candidates = await searchEntitiesByEmbedding({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      queryEmbedding,
      kinds: ["decision"],
      ...(projectRecord ? { projectRecord } : {}),
      limit: 10,
    });

    // Check if any existing decision resolves the question
    const questionTokens = normalizeTokens(body.question);
    const relevant = candidates.filter((c) => {
      const tokens = normalizeTokens(c.name);
      return c.score >= 0.78 && hasTokenOverlap(questionTokens, tokens);
    });

    if (relevant.length > 0) {
      const best = relevant[0];
      return jsonResponse({
        decision: best.name,
        confidence: Number(best.score.toFixed(4)),
        status: best.status ?? "unknown",
        rationale: `Existing ${best.status} decision found with ${(best.score * 100).toFixed(1)}% similarity`,
        sources: relevant.map((r) => ({ id: `${r.kind}:${r.id}`, name: r.name, score: Number(r.score.toFixed(4)) })),
      }, 200);
    }

    return jsonResponse({
      decision: undefined,
      confidence: 0,
      status: "unresolved",
      rationale: "No existing decision found that resolves this question",
      sources: candidates.slice(0, 5).map((c) => ({
        id: `${c.kind}:${c.id}`,
        name: c.name,
        score: Number(c.score.toFixed(4)),
      })),
    }, 200);
  }

  /** POST /api/mcp/:workspaceId/constraints/check — Check proposed action */
  async function handleCheckConstraints(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ proposed_action: string; project?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.proposed_action) return jsonError("proposed_action is required", 400);

    const queryEmbedding = await createEmbeddingVector(
      deps.embeddingModel,
      body.proposed_action,
      config.embeddingDimension,
    );

    if (!queryEmbedding) {
      return jsonResponse({ hard_conflicts: [], soft_tensions: [], supporting: [], proceed: true }, 200);
    }

    const projectRecord = body.project
      ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: auth.workspaceRecord, projectInput: body.project })
      : undefined;

    const candidates = await listDecisionConstraintCandidates({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      queryEmbedding,
      ...(projectRecord ? { projectRecord } : {}),
      limit: 14,
    });

    const actionTokens = normalizeTokens(body.proposed_action);
    const hardConflicts: Array<{ id: string; name: string; score: number; reason: string }> = [];
    const softTensions: Array<{ id: string; name: string; score: number; reason: string }> = [];
    const supporting: Array<{ id: string; name: string; score: number; reason: string }> = [];

    for (const candidate of candidates) {
      const candidateTokens = normalizeTokens(candidate.name);
      const overlap = hasTokenOverlap(actionTokens, candidateTokens);
      const status = candidate.status?.toLowerCase();

      if (candidate.kind === "decision" && overlap && (status === "contested" || status === "superseded")) {
        hardConflicts.push({
          id: `${candidate.kind}:${candidate.id}`,
          name: candidate.name,
          score: Number(candidate.score.toFixed(4)),
          reason: `Decision is marked ${status}.`,
        });
        continue;
      }

      if (candidate.kind === "decision" && candidate.score >= 0.86 && overlap) {
        supporting.push({
          id: `${candidate.kind}:${candidate.id}`,
          name: candidate.name,
          score: Number(candidate.score.toFixed(4)),
          reason: "High-similarity decision aligns with proposed action.",
        });
        continue;
      }

      if (candidate.score >= 0.72) {
        softTensions.push({
          id: `${candidate.kind}:${candidate.id}`,
          name: candidate.name,
          score: Number(candidate.score.toFixed(4)),
          reason: overlap
            ? "Related decision/question may require consistency checks."
            : "Semantically related context may be affected.",
        });
      }
    }

    return jsonResponse({ hard_conflicts: hardConflicts, soft_tensions: softTensions, supporting, proceed: hardConflicts.length === 0 }, 200);
  }

  // =========================================================================
  // Tier 3 — Write
  // =========================================================================

  /** POST /api/mcp/:workspaceId/decisions/provisional — Create provisional decision */
  async function handleCreateProvisionalDecision(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      name: string;
      rationale: string;
      context?: { project?: string; feature?: string };
      options_considered?: string[];
    }>(request);
    if (body instanceof Response) return body;
    if (!body.name) return jsonError("name is required", 400);
    if (!body.rationale) return jsonError("rationale is required", 400);

    const projectRecord = body.context?.project
      ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: auth.workspaceRecord, projectInput: body.context.project })
      : undefined;

    const featureRecord = body.context?.feature
      ? await resolveWorkspaceFeatureRecord({ surreal, workspaceRecord: auth.workspaceRecord, featureInput: body.context.feature })
      : undefined;

    const decisionRecord = await createDecisionRecord({
      surreal,
      summary: body.name,
      status: "provisional",
      now: new Date(),
      workspaceRecord: auth.workspaceRecord,
      rationale: body.rationale,
      ...(body.options_considered?.length ? { optionsConsidered: body.options_considered } : {}),
      decidedByName: "code-agent",
      ...(projectRecord ? { projectRecord } : {}),
      ...(featureRecord ? { featureRecord } : {}),
    });

    logInfo("mcp.decision.created", "Provisional decision created via MCP", {
      workspaceId,
      decisionId: decisionRecord.id as string,
    });

    return jsonResponse({
      decision_id: decisionRecord.id as string,
      status: "provisional",
      review_required: true,
    }, 201);
  }

  /** POST /api/mcp/:workspaceId/questions — Ask a question */
  async function handleAskQuestion(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      text: string;
      context?: { project?: string; feature?: string; task?: string };
      options?: string[];
      blocking_task?: string;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.text) return jsonError("text is required", 400);

    let blockingTaskId: string | undefined;
    if (body.blocking_task) {
      try {
        blockingTaskId = requireRawId(body.blocking_task, "blocking_task");
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "invalid blocking_task", 400);
      }
      const scopedTaskError = await requireScopedRecord(new RecordId("task", blockingTaskId), auth.workspaceRecord, "task");
      if (scopedTaskError) return scopedTaskError;
    }

    const projectRecord = body.context?.project
      ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: auth.workspaceRecord, projectInput: body.context.project })
      : undefined;

    const featureRecord = body.context?.feature
      ? await resolveWorkspaceFeatureRecord({ surreal, workspaceRecord: auth.workspaceRecord, featureInput: body.context.feature })
      : undefined;

    const questionRecord = await createQuestionRecord({
      surreal,
      text: body.text,
      status: "asked",
      now: new Date(),
      workspaceRecord: auth.workspaceRecord,
      ...(projectRecord ? { projectRecord } : {}),
      ...(featureRecord ? { featureRecord } : {}),
    });

    // Set coding agent fields directly
    await surreal.update(questionRecord).merge({
      asked_by: "code-agent",
      ...(body.options?.length ? { options: body.options } : {}),
      ...(blockingTaskId ? { blocking_task: new RecordId("task", blockingTaskId) } : {}),
    });

    logInfo("mcp.question.created", "Question created via MCP", {
      workspaceId,
      questionId: questionRecord.id as string,
    });

    return jsonResponse({
      question_id: questionRecord.id as string,
      status: "asked",
    }, 201);
  }

  /** POST /api/mcp/:workspaceId/tasks/status — Update task status */
  async function handleUpdateTaskStatus(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{ task_id: string; status: string; notes?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.task_id) return jsonError("task_id is required", 400);
    if (!body.status) return jsonError("status is required", 400);
    let taskId: string;
    try {
      taskId = requireRawId(body.task_id, "task_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid task_id", 400);
    }
    const taskRecord = new RecordId("task", taskId);
    const scopedTaskError = await requireScopedRecord(taskRecord, auth.workspaceRecord, "task");
    if (scopedTaskError) return scopedTaskError;
    const result = await updateTaskStatus({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      taskRecord,
      status: body.status,
      notes: body.notes,
    });

    return jsonResponse(result, 200);
  }

  /** POST /api/mcp/:workspaceId/tasks/subtask — Create subtask */
  async function handleCreateSubtask(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      parent_task_id: string;
      title: string;
      category?: string;
      rationale?: string;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.parent_task_id) return jsonError("parent_task_id is required", 400);
    if (!body.title) return jsonError("title is required", 400);
    let parentTaskId: string;
    try {
      parentTaskId = requireRawId(body.parent_task_id, "parent_task_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid parent_task_id", 400);
    }
    const parentTaskRecord = new RecordId("task", parentTaskId);
    const scopedParentError = await requireScopedRecord(parentTaskRecord, auth.workspaceRecord, "parent task");
    if (scopedParentError) return scopedParentError;
    const result = await createSubtask({
      surreal,
      parentTaskRecord,
      title: body.title,
      workspaceRecord: auth.workspaceRecord,
      category: body.category,
      rationale: body.rationale,
    });

    return jsonResponse(result, result.already_existed ? 200 : 201);
  }

  /** POST /api/mcp/:workspaceId/notes — Log implementation note */
  async function handleLogNote(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      entity_id: string;
      note: string;
      files_changed?: string[];
    }>(request);
    if (body instanceof Response) return body;
    if (!body.entity_id) return jsonError("entity_id is required", 400);
    if (!body.note) return jsonError("note is required", 400);

    // Parse "table:id" format
    const separatorIdx = body.entity_id.indexOf(":");
    if (separatorIdx === -1) return jsonError("entity_id must be in table:id format", 400);

    let entityRecord: RecordId<GraphEntityTable, string>;
    try {
      entityRecord = parseRecordIdString(body.entity_id, ENTITY_TABLES);
    } catch {
      return jsonError("entity_id must be a valid table:id reference", 400);
    }
    const scopedEntityError = await requireScopedRecord(entityRecord, auth.workspaceRecord, "entity");
    if (scopedEntityError) return scopedEntityError;

    const result = await logImplementationNote({
      surreal,
      entityTable: entityRecord.table.name,
      entityId: entityRecord.id as string,
      note: body.note,
      filesChanged: body.files_changed,
    });

    return jsonResponse(result, 200);
  }

  /** POST /api/mcp/:workspaceId/observations — Log a codebase observation */
  async function handleLogObservation(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      text: string;
      category: string;
      severity: string;
      target?: string;
      session_id?: string;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.text) return jsonError("text is required", 400);
    if (!body.category) return jsonError("category is required", 400);
    if (!body.severity) return jsonError("severity is required", 400);

    if (!OBSERVATION_TYPES.includes(body.category as ObservationType)) {
      return jsonError(`invalid category: must be one of ${OBSERVATION_TYPES.join(", ")}`, 400);
    }

    const validSeverities = ["info", "warning", "conflict"];
    if (!validSeverities.includes(body.severity)) {
      return jsonError("invalid severity: must be info, warning, or conflict", 400);
    }

    type ObserveTable = "project" | "feature" | "task" | "decision" | "question";
    let relatedRecord: RecordId<ObserveTable, string> | undefined;
    if (body.target) {
      try {
        relatedRecord = parseRecordIdString(body.target, ["project", "feature", "task", "decision", "question"] as const);
      } catch {
        return jsonError(`invalid target entity: ${body.target}`, 400);
      }
      const scopedTargetError = await requireScopedRecord(relatedRecord, auth.workspaceRecord, "target");
      if (scopedTargetError) return scopedTargetError;
    }

    const embedding = await createEmbeddingVector(
      deps.embeddingModel,
      body.text,
      config.embeddingDimension,
    );

    let sourceSessionRecord: RecordId<"agent_session", string> | undefined;
    if (body.session_id) {
      try {
        const sessionId = requireRawId(body.session_id, "session_id");
        sourceSessionRecord = new RecordId("agent_session", sessionId);
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "invalid session_id", 400);
      }
    }
    if (sourceSessionRecord) {
      const scopedSessionError = await requireScopedRecord(sourceSessionRecord, auth.workspaceRecord, "session");
      if (scopedSessionError) return scopedSessionError;
    }

    const now = new Date();

    const observationRecord = await createObservation({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      text: body.text,
      severity: body.severity as ObservationSeverity,
      observationType: body.category as ObservationType,
      sourceAgent: "code-agent",
      now,
      ...(sourceSessionRecord ? { sourceSessionRecord } : {}),
      ...(relatedRecord ? { relatedRecord } : {}),
      ...(embedding ? { embedding } : {}),
    });

    // Create observed_in edge: observation -> agent_session
    if (sourceSessionRecord) {
      await surreal
        .relate(observationRecord, new RecordId("observed_in", crypto.randomUUID()), sourceSessionRecord, {
          added_at: now,
        })
        .output("after");
    }

    logInfo("mcp.observation.created", "Observation logged via MCP", {
      workspaceId,
      observationId: observationRecord.id as string,
      observationType: body.category,
      severity: body.severity,
    });

    return jsonResponse({
      observation_id: observationRecord.id as string,
      severity: body.severity,
      status: "open",
    }, 201);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /** POST /api/mcp/:workspaceId/sessions/start — Start agent session */
  async function handleSessionStart(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      agent: string;
      project_id: string;
      task_id?: string;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.agent) return jsonError("agent is required", 400);
    if (!body.project_id) return jsonError("project_id is required", 400);
    let projectId: string;
    let taskId: string | undefined;
    try {
      projectId = requireRawId(body.project_id, "project_id");
      taskId = body.task_id ? requireRawId(body.task_id, "task_id") : undefined;
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid id", 400);
    }
    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;
    if (taskId) {
      const scopedTaskError = await requireScopedRecord(new RecordId("task", taskId), auth.workspaceRecord, "task");
      if (scopedTaskError) return scopedTaskError;
    }
    const result = await createAgentSession({
      surreal,
      agent: body.agent,
      workspaceRecord: auth.workspaceRecord,
      projectRecord,
      ...(taskId ? { taskId } : {}),
    });

    return jsonResponse(result, 201);
  }

  /** POST /api/mcp/:workspaceId/sessions/end — End agent session */
  async function handleSessionEnd(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      session_id: string;
      summary: string;
      decisions_made?: string[];
      questions_asked?: string[];
      tasks_progressed?: Array<{ task_id: string; from_status: string; to_status: string }>;
      files_changed?: Array<{ path: string; change_type: string }>;
      observations_logged?: string[];
    }>(request);
    if (body instanceof Response) return body;
    if (!body.session_id) return jsonError("session_id is required", 400);
    if (!body.summary) return jsonError("summary is required", 400);
    try {
      requireRawId(body.session_id, "session_id");
      for (const id of body.decisions_made ?? []) requireRawId(id, "decisions_made[]");
      for (const id of body.questions_asked ?? []) requireRawId(id, "questions_asked[]");
      for (const id of body.observations_logged ?? []) requireRawId(id, "observations_logged[]");
      for (const t of body.tasks_progressed ?? []) requireRawId(t.task_id, "tasks_progressed[].task_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid id", 400);
    }

    const result = await endAgentSession({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      sessionId: body.session_id,
      summary: body.summary,
      decisionsMade: body.decisions_made,
      questionsAsked: body.questions_asked,
      tasksProgressed: body.tasks_progressed,
      filesChanged: body.files_changed,
      observationsLogged: body.observations_logged,
    });

    return jsonResponse(result, 200);
  }

  /** POST /api/mcp/:workspaceId/commits — Log git commit */
  async function handleLogCommit(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      project_id: string;
      sha: string;
      message: string;
      author: string;
      task_updates?: Array<{ task_id: string; new_status: string }>;
      related_task_ids?: string[];
      decisions_detected?: Array<{ name: string; rationale: string }>;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.sha) return jsonError("sha is required", 400);
    if (!body.message) return jsonError("message is required", 400);
    if (!body.project_id) return jsonError("project_id is required", 400);
    let projectId: string;
    try {
      projectId = requireRawId(body.project_id, "project_id");
      for (const update of body.task_updates ?? []) requireRawId(update.task_id, "task_updates[].task_id");
      for (const taskId of body.related_task_ids ?? []) requireRawId(taskId, "related_task_ids[]");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid project_id", 400);
    }
    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;
    for (const update of body.task_updates ?? []) {
      const scopedTaskError = await requireScopedRecord(new RecordId("task", update.task_id), auth.workspaceRecord, "task");
      if (scopedTaskError) return scopedTaskError;
    }
    for (const taskId of body.related_task_ids ?? []) {
      const scopedTaskError = await requireScopedRecord(new RecordId("task", taskId), auth.workspaceRecord, "task");
      if (scopedTaskError) return scopedTaskError;
    }
    const result = await logCommit({
      surreal,
      workspaceRecord: auth.workspaceRecord,
      projectRecord,
      sha: body.sha,
      message: body.message,
      author: body.author ?? "unknown",
      taskUpdates: body.task_updates,
      relatedTaskIds: body.related_task_ids,
      decisionsDetected: body.decisions_detected,
    });

    return jsonResponse(result, 201);
  }

  // =========================================================================
  // Git — Check commit
  // =========================================================================

  const commitCheckSchema = z.object({
    task_completions: z.array(z.object({
      task_title: z.string().describe("Title of the task this commit likely completes"),
      confidence: z.number().describe("0-1 confidence score"),
    })),
    unlogged_decisions: z.array(z.object({
      description: z.string().describe("What architectural/design decision was made"),
    })),
    constraint_violations: z.array(z.object({
      constraint: z.string().describe("The constraint being violated"),
      violation: z.string().describe("How the diff violates it"),
      severity: z.enum(["warning", "error"]),
    })),
    summary: z.string().describe("One-line summary of the analysis"),
  });

  /** POST /api/mcp/:workspaceId/commits/check — Pre-commit LLM analysis */
  async function handleCheckCommit(workspaceId: string, request: Request): Promise<Response> {
    const auth = await requireAuth(request, workspaceId);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody<{
      project_id: string;
      diff: string;
      commit_message: string;
    }>(request);
    if (body instanceof Response) return body;
    if (!body.project_id) return jsonError("project_id is required", 400);
    if (!body.diff) return jsonError("diff is required", 400);
    let projectId: string;
    try {
      projectId = requireRawId(body.project_id, "project_id");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "invalid project_id", 400);
    }
    const projectRecord = new RecordId("project", projectId);
    const scopedProjectError = await requireScopedRecord(projectRecord, auth.workspaceRecord, "project");
    if (scopedProjectError) return scopedProjectError;

    // Load project context for analysis
    const [decisions, constraints, activeTasks] = await Promise.all([
      listProjectDecisions({
        surreal,
        workspaceRecord: auth.workspaceRecord,
        projectRecord,
      }),
      listProjectConstraints({
        surreal,
        workspaceRecord: auth.workspaceRecord,
        projectRecord,
      }),
      surreal.query<[Array<{ title: string; status: string; source_session?: string }>]>(
        `SELECT title, status, source_session FROM task WHERE workspace = $ws AND status IN ["todo", "in_progress"] ORDER BY created_at DESC LIMIT 30;`,
        { ws: auth.workspaceRecord },
      ).then((r) => r[0] ?? []),
    ]);

    // Truncate diff for token budget
    const truncatedDiff = body.diff.length > 8000 ? body.diff.slice(0, 8000) + "\n... (truncated)" : body.diff;

    const result = await generateObject({
      model: extractionModel,
      schema: commitCheckSchema,
      temperature: 0.1,
      system: [
        "You are a pre-commit analyzer for a knowledge graph-integrated development workflow.",
        "Analyze the staged git diff and commit message against the project context.",
        "Detect:",
        "1. Task completions — does this commit complete or substantially finish any active tasks?",
        "2. Unlogged decisions — does this commit introduce architectural or design decisions not already in the knowledge graph?",
        "3. Constraint violations — does this commit contradict any confirmed decisions or active constraints?",
        "Be conservative: only flag items with genuine evidence in the diff. Empty arrays are fine if nothing is detected.",
      ].join("\n"),
      prompt: [
        "## Commit message",
        body.commit_message || "(no message)",
        "",
        "## Staged diff",
        truncatedDiff,
        "",
        "## Active tasks",
        activeTasks.length > 0
          ? activeTasks.map((t) => `- [${t.status}] ${t.title}`).join("\n")
          : "(no active tasks)",
        "",
        "## Recent decisions",
        (() => {
          const allDecisions = [...decisions.confirmed, ...decisions.provisional, ...decisions.contested];
          return allDecisions.length > 0
            ? allDecisions.map((d) => `- [${d.status}] ${d.summary}`).join("\n")
            : "(no decisions)";
        })(),
        "",
        "## Active constraints",
        constraints.length > 0
          ? constraints.map((c) => `- [${c.severity}] ${c.text}`).join("\n")
          : "(no constraints)",
      ].join("\n"),
    });

    return jsonResponse(result.object, 200);
  }

  // =========================================================================
  // Return all handlers
  // =========================================================================

  return {
    // Setup
    handleAuthInit,
    handleListProjects,
    // Tier 1 — Read
    handleGetContext,
    handleGetDecisions,
    handleGetTaskDependencies,
    handleGetConstraints,
    handleGetChanges,
    handleGetEntityDetail,
    // Tier 2 — Reason
    handleResolveDecision,
    handleCheckConstraints,
    // Tier 3 — Write
    handleCreateProvisionalDecision,
    handleAskQuestion,
    handleUpdateTaskStatus,
    handleCreateSubtask,
    handleLogNote,
    handleLogObservation,
    // Lifecycle
    handleSessionStart,
    handleSessionEnd,
    handleLogCommit,
    handleCheckCommit,
  };
}
