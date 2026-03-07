import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import type {
  CreateWorkspaceResponse,
  DiscussEntitySummary,
  OnboardingSeedItem,
  WorkspaceBootstrapMessage,
  WorkspaceBootstrapResponse,
  WorkspaceConversationResponse,
  SourceKind,
  EntityKind,
} from "../../shared/contracts";
import { readEntityName } from "../graph/queries";
import { readEntityText } from "../extraction/entity-text";
import type { GraphEntityRecord, SourceRecord } from "../extraction/types";
import { HttpError } from "../http/errors";
import { elapsedMs, logDebug, logError, logInfo, logWarn } from "../http/observability";
import { parseCreateWorkspaceRequest } from "../http/parsing";
import { jsonError, jsonResponse, toIsoString } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { toOnboardingState } from "../onboarding/onboarding-state";
import { resolveWorkspaceRecord } from "./workspace-scope";
import { buildWorkspaceConversationSidebar } from "./conversation-sidebar";
import { loadMessagesWithInheritance } from "../chat/branch-chain";
import { validateRepoPath } from "./validate-repo-path";
import type { ShellExecResult } from "../orchestrator/worktree-manager";

type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
  description?: string;
  repo_path?: string;
  status: string;
  onboarding_complete: boolean;
  onboarding_turn_count: number;
  onboarding_summary_pending: boolean;
};

type ProvenanceEdgeRow = {
  id: RecordId<"extraction_relation", string>;
  in: SourceRecord;
  out: GraphEntityRecord;
  confidence: number;
  extracted_at: Date | string;
};

type ShellExec = (command: string, args: string[], cwd: string) => Promise<ShellExecResult>;

export function createWorkspaceRouteHandlers(
  deps: ServerDependencies,
  shellExec?: ShellExec,
): {
  handleCreateWorkspace: (request: Request) => Promise<Response>;
  handleWorkspaceBootstrap: (workspaceId: string) => Promise<Response>;
  handleWorkspaceSidebar: (workspaceId: string) => Promise<Response>;
  handleWorkspaceConversation: (workspaceId: string, conversationId: string) => Promise<Response>;
  handleUpdateRepoPath: (workspaceId: string, request: Request) => Promise<Response>;
} {
  return {
    handleCreateWorkspace: (request: Request) => handleCreateWorkspace(deps, request, shellExec),
    handleWorkspaceBootstrap: (workspaceId: string) => handleWorkspaceBootstrap(deps, workspaceId),
    handleWorkspaceSidebar: (workspaceId: string) => handleWorkspaceSidebar(deps, workspaceId),
    handleWorkspaceConversation: (workspaceId: string, conversationId: string) =>
      handleWorkspaceConversation(deps, workspaceId, conversationId),
    handleUpdateRepoPath: (workspaceId: string, request: Request) =>
      handleUpdateRepoPath(deps, workspaceId, request, shellExec),
  };
}

async function handleCreateWorkspace(deps: ServerDependencies, request: Request, shellExec?: ShellExec): Promise<Response> {
  const startedAt = performance.now();
  logInfo("workspace.create.started", "Workspace creation started");

  const session = await deps.auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("authentication required", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseCreateWorkspaceRequest(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  // Validate repoPath if provided
  if (parsed.data.repoPath && shellExec) {
    const repoValidation = await validateRepoPath(parsed.data.repoPath, shellExec);
    if (!repoValidation.ok) {
      return jsonError(repoValidation.error, 400);
    }
  }

  logDebug("http.request.validated", "Workspace request validated");

  const now = new Date();
  const workspaceId = randomUUID();
  const conversationId = randomUUID();

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const conversationRecord = new RecordId("conversation", conversationId);
  const ownerRecord = new RecordId("person", session.user.id);
  const starterMessageRecord = new RecordId("message", randomUUID());
  const hasDescription = parsed.data.description !== undefined;
  const ownerName = session.user.name ?? "there";

  const starterSuggestions = hasDescription
    ? [
        "Describe your first project",
        "Share the biggest current bottleneck",
        "Upload a plan or spec to extract",
      ]
    : [
        "Describe your business and goals",
        "Share the biggest current bottleneck",
        "Upload a plan or spec to extract",
      ];

  const starterMessage = hasDescription
    ? [
        `Hey ${ownerName}!`,
        `Got it — I'll help you organize ${parsed.data.name}.`,
        "What are the main projects or product areas you want to track?",
        "You can also drop in a document (plan, spec, PRD) and I'll extract everything from it.",
      ].join(" ")
    : [
        `Hey ${ownerName}!`,
        "I'm ready to help you build out your workspace.",
        "Tell me about what you're working on - what's the main project or business you want to track here?",
        "If you have an existing document (like a plan or spec), you can drop it in and I'll extract everything from it.",
      ].join(" ");

  const transaction = await deps.surreal.beginTransaction();
  try {
    await transaction.create(workspaceRecord).content({
      name: parsed.data.name,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      ...(parsed.data.repoPath ? { repo_path: parsed.data.repoPath } : {}),
      status: "active",
      onboarding_complete: false,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: now,
      created_at: now,
      updated_at: now,
    });

    await transaction.relate(ownerRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
      role: "owner",
      added_at: now,
    }).output("after");

    await transaction.create(conversationRecord).content({
      createdAt: now,
      updatedAt: now,
      workspace: workspaceRecord,
      source: "onboarding",
      title: "Onboarding",
      title_source: "message",
    });

    await transaction.create(starterMessageRecord).content({
      conversation: conversationRecord,
      role: "assistant",
      text: starterMessage,
      suggestions: starterSuggestions,
      createdAt: now,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.cancel();
    logError("workspace.create.failed", "Workspace creation failed", error, {
      workspaceId,
      conversationId,
    });
    const errorText = error instanceof Error ? error.message : "workspace creation failed";
    return jsonError(errorText, 500);
  }

  const response: CreateWorkspaceResponse = {
    workspaceId,
    workspaceName: parsed.data.name,
    conversationId,
    onboardingComplete: false,
  };

  logInfo("workspace.create.completed", "Workspace creation completed", {
    workspaceId,
    conversationId,
    durationMs: elapsedMs(startedAt),
  });

  return jsonResponse(response, 200);
}

async function handleWorkspaceBootstrap(deps: ServerDependencies, workspaceId: string): Promise<Response> {
  const startedAt = performance.now();
  logInfo("workspace.bootstrap.started", "Workspace bootstrap started", { workspaceId });

  try {
    const workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    const workspace = await deps.surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      throw new HttpError(404, `workspace not found: ${workspaceId}`);
    }

    const conversationRecord = await resolveWorkspaceBootstrapConversation(deps, workspaceRecord);
    const conversationId = conversationRecord.id as string;
    const rawMessages = await loadMessagesWithInheritance(deps.surreal, conversationId, 80);

    const messages = rawMessages.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: toIsoString(row.createdAt),
      ...(row.suggestions && row.suggestions.length > 0 ? { suggestions: row.suggestions } : {}),
      ...(row.inherited ? { inherited: true } : {}),
      ...(row.subagent_traces && row.subagent_traces.length > 0 ? { subagentTraces: row.subagent_traces } : {}),
    } satisfies WorkspaceBootstrapMessage));

    const seeds = await loadWorkspaceSeeds(deps, workspaceRecord, 40);
    const onboardingState = toOnboardingState(workspace);
    const sidebar = await buildWorkspaceConversationSidebar(deps.surreal, workspaceRecord);

    const payload: WorkspaceBootstrapResponse = {
      workspaceId: workspace.id.id as string,
      workspaceName: workspace.name,
      ...(workspace.description ? { workspaceDescription: workspace.description } : {}),
      ...(workspace.repo_path ? { repoPath: workspace.repo_path } : {}),
      onboardingComplete: workspace.onboarding_complete,
      onboardingState,
      conversationId: conversationRecord.id as string,
      messages,
      seeds,
      sidebar,
    };

    logInfo("workspace.bootstrap.completed", "Workspace bootstrap completed", {
      workspaceId,
      conversationId: conversationRecord.id as string,
      messageCount: messages.length,
      seedCount: seeds.length,
      durationMs: elapsedMs(startedAt),
    });

    return jsonResponse(payload, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("workspace.bootstrap.http_error", "Workspace bootstrap failed with client-facing error", {
        workspaceId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("workspace.bootstrap.failed", "Workspace bootstrap failed", error, { workspaceId });
    const errorText = error instanceof Error ? error.message : "workspace bootstrap failed";
    return jsonError(errorText, 500);
  }
}

async function resolveWorkspaceBootstrapConversation(
  deps: ServerDependencies,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<RecordId<"conversation", string>> {
  const [onboardingRows] = await deps.surreal
    .query<[Array<{ id: RecordId<"conversation", string> }>]>(
      "SELECT id, createdAt FROM conversation WHERE workspace = $workspace AND source = 'onboarding' ORDER BY createdAt ASC LIMIT 1;",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"conversation", string> }>]>();

  if (onboardingRows.length > 0) {
    return onboardingRows[0].id;
  }

  const [latestRows] = await deps.surreal
    .query<[Array<{ id: RecordId<"conversation", string> }>]>(
      "SELECT id, createdAt FROM conversation WHERE workspace = $workspace ORDER BY createdAt DESC LIMIT 1;",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"conversation", string> }>]>();

  if (latestRows.length > 0) {
    return latestRows[0].id;
  }

  const now = new Date();
  const conversationRecord = new RecordId("conversation", randomUUID());
  await deps.surreal.create(conversationRecord).content({
    createdAt: now,
    updatedAt: now,
    workspace: workspaceRecord,
    source: "onboarding",
  });
  return conversationRecord;
}

async function loadWorkspaceSeeds(
  deps: ServerDependencies,
  workspaceRecord: RecordId<"workspace", string>,
  limit: number,
): Promise<OnboardingSeedItem[]> {
  const [edgeRows] = await deps.surreal
    .query<[ProvenanceEdgeRow[]]>(
      [
        "SELECT id, `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE `in` IN array::concat(",
        "  (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)),",
        "  (SELECT VALUE id FROM document_chunk WHERE workspace = $workspace)",
        ")",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: workspaceRecord,
        limit,
      },
    )
    .collect<[ProvenanceEdgeRow[]]>();

  const items: OnboardingSeedItem[] = [];

  for (const edge of edgeRows) {
    const entityText = await readEntityText(deps.surreal, edge.out);
    if (!entityText) {
      continue;
    }

    const sourceTable = edge.in.table.name;
    const entityTable = edge.out.table.name;
    const sourceKind = (sourceTable === "document_chunk" ? "document_chunk" : "message") as SourceKind;
    const sourceLabel = await readSourceLabel(deps, edge.in);

    items.push({
      id: edge.out.id as string,
      kind: entityTable as EntityKind,
      text: entityText,
      confidence: edge.confidence,
      sourceKind,
      sourceId: edge.in.id as string,
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  }

  return items;
}

async function readSourceLabel(deps: ServerDependencies, sourceRecord: SourceRecord): Promise<string | undefined> {
  const sourceTable = sourceRecord.table.name;
  if (sourceTable === "message") {
    const row = await deps.surreal.select<{ text: string }>(sourceRecord);
    if (!row) {
      return undefined;
    }
    return row.text.slice(0, 140);
  }

  const chunk = await deps.surreal.select<{
    section_heading?: string;
    document: RecordId<"document", string>;
  }>(sourceRecord);

  if (!chunk) {
    return undefined;
  }

  const document = await deps.surreal.select<{ name: string }>(chunk.document);
  if (!document) {
    return chunk.section_heading;
  }

  if (chunk.section_heading) {
    return `${document.name} · ${chunk.section_heading}`;
  }

  return document.name;
}

async function handleWorkspaceSidebar(deps: ServerDependencies, workspaceId: string): Promise<Response> {
  const startedAt = performance.now();
  logInfo("workspace.sidebar.started", "Workspace sidebar request started", { workspaceId });

  try {
    const workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    const sidebar = await buildWorkspaceConversationSidebar(deps.surreal, workspaceRecord);

    logInfo("workspace.sidebar.completed", "Workspace sidebar request completed", {
      workspaceId,
      groupCount: sidebar.groups.length,
      unlinkedCount: sidebar.unlinked.length,
      durationMs: elapsedMs(startedAt),
    });

    return jsonResponse(sidebar, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("workspace.sidebar.http_error", "Workspace sidebar failed with client-facing error", {
        workspaceId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("workspace.sidebar.failed", "Workspace sidebar request failed", error, { workspaceId });
    const errorText = error instanceof Error ? error.message : "workspace sidebar failed";
    return jsonError(errorText, 500);
  }
}

async function handleWorkspaceConversation(
  deps: ServerDependencies,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  const startedAt = performance.now();
  logInfo("workspace.conversation.started", "Workspace conversation request started", {
    workspaceId,
    conversationId,
  });

  try {
    const workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    const conversationRecord = new RecordId("conversation", conversationId);
    const conversation = await deps.surreal.select<{
      id: RecordId<"conversation", string>;
      workspace: RecordId<"workspace", string>;
      discusses?: RecordId;
    }>(conversationRecord);

    if (!conversation) {
      throw new HttpError(404, `conversation not found: ${conversationId}`);
    }

    if ((conversation.workspace.id as string) !== (workspaceRecord.id as string)) {
      throw new HttpError(400, "conversation does not belong to workspace");
    }

    const rawMessages = await loadMessagesWithInheritance(deps.surreal, conversationId, 80);

    const messages = rawMessages.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: toIsoString(row.createdAt),
      ...(row.suggestions && row.suggestions.length > 0 ? { suggestions: row.suggestions } : {}),
      ...(row.inherited ? { inherited: true } : {}),
      ...(row.subagent_traces && row.subagent_traces.length > 0 ? { subagentTraces: row.subagent_traces } : {}),
    } satisfies WorkspaceBootstrapMessage));

    let discussEntity: DiscussEntitySummary | undefined;
    if (conversation.discusses) {
      const entityRecord = conversation.discusses as GraphEntityRecord;
      const name = await readEntityName(deps.surreal, entityRecord);
      if (name) {
        const entityRow = await deps.surreal.select<Record<string, unknown>>(entityRecord);
        discussEntity = {
          id: `${entityRecord.table.name}:${entityRecord.id as string}`,
          kind: entityRecord.table.name as EntityKind,
          name,
          ...(entityRow && typeof entityRow.status === "string" ? { status: entityRow.status } : {}),
        };
      }
    }

    const payload: WorkspaceConversationResponse = {
      conversationId,
      messages,
      ...(discussEntity ? { discussEntity } : {}),
    };

    logInfo("workspace.conversation.completed", "Workspace conversation request completed", {
      workspaceId,
      conversationId,
      messageCount: messages.length,
      durationMs: elapsedMs(startedAt),
    });

    return jsonResponse(payload, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("workspace.conversation.http_error", "Workspace conversation failed with client-facing error", {
        workspaceId,
        conversationId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("workspace.conversation.failed", "Workspace conversation request failed", error, {
      workspaceId,
      conversationId,
    });
    const errorText = error instanceof Error ? error.message : "workspace conversation failed";
    return jsonError(errorText, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/repo-path
// ---------------------------------------------------------------------------

async function handleUpdateRepoPath(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
  shellExec?: ShellExec,
): Promise<Response> {
  const startedAt = performance.now();
  logInfo("workspace.repo_path.update.started", "Repo path update started", { workspaceId });

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }

    if (!body || typeof body !== "object") {
      return jsonError("Body must be an object", 400);
    }

    const { path: rawPath } = body as { path?: string };
    if (!rawPath || typeof rawPath !== "string" || rawPath.trim().length === 0) {
      return jsonError("path is required", 400);
    }

    if (!shellExec) {
      return jsonError("shell execution not available", 500);
    }

    const trimmedPath = rawPath.trim();

    const repoValidation = await validateRepoPath(trimmedPath, shellExec);
    if (!repoValidation.ok) {
      return jsonError(repoValidation.error, 400);
    }

    const workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);

    await deps.surreal.query(
      "UPDATE $workspace SET repo_path = $repoPath, updated_at = time::now();",
      { workspace: workspaceRecord, repoPath: trimmedPath },
    );

    logInfo("workspace.repo_path.update.completed", "Repo path update completed", {
      workspaceId,
      repoPath: trimmedPath,
      durationMs: elapsedMs(startedAt),
    });

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("workspace.repo_path.update.http_error", "Repo path update failed with client-facing error", {
        workspaceId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("workspace.repo_path.update.failed", "Repo path update failed", error, { workspaceId });
    const errorText = error instanceof Error ? error.message : "repo path update failed";
    return jsonError(errorText, 500);
  }
}
