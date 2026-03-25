/**
 * Brain Tools Handler — Effect boundary for executing Brain-native tools
 * from the MCP agent endpoint.
 *
 * Read tools call extracted execute* functions directly.
 * Write tools call underlying query functions (no extraction provenance,
 * matching the CLI MCP route pattern in mcp-route.ts).
 *
 * Effect boundary: performs IO (SurrealDB queries).
 */
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { executeSearchEntities } from "../tools/search-entities";
import type { SearchEntityKind } from "../graph/queries";
import { executeListWorkspaceEntities } from "../tools/list-workspace-entities";
import { executeGetEntityDetail } from "../tools/get-entity-detail";
import { executeGetProjectStatus } from "../tools/get-project-status";
import { executeGetConversationHistory } from "../tools/get-conversation-history";
import { executeCheckConstraints } from "../tools/check-constraints";
import { executeResolveDecisionReadOnly } from "../tools/resolve-decision";
import { createDecisionRecord, createQuestionRecord, resolveWorkspaceProjectRecord, resolveWorkspaceFeatureRecord, parseRecordIdString, isEntityInWorkspace, readEntityName, createProjectRecord } from "../graph/queries";
import { createObservation } from "../observation/queries";
import { createSuggestion } from "../suggestion/queries";
import { acknowledgeObservation, resolveObservation } from "../observation/queries";
import { searchEntitiesByBm25 } from "../graph/bm25-search";
import { seedDescriptionEntry } from "../descriptions/persist";
import { ensureProjectFeatureEdge } from "../workspace/workspace-scope";
import type { ToolCallResult } from "./tools-call-handler";
import type { EntityCategory, SuggestionCategory } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrainToolCallContext = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
};

export type BrainToolCallDeps = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Read tool dispatch
// ---------------------------------------------------------------------------

async function dispatchReadTool(
  toolName: string,
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
): Promise<unknown> {
  switch (toolName) {
    case "search_entities":
      return executeSearchEntities(surreal, ws, {
        query: args.query as string,
        kinds: args.kinds as SearchEntityKind[] | undefined,
        limit: (args.limit as number) ?? 10,
      });

    case "list_workspace_entities":
      return executeListWorkspaceEntities(surreal, ws, {
        kind: args.kind as string,
        status: args.status as string | undefined,
        project: args.project as string | undefined,
        limit: (args.limit as number) ?? 25,
      });

    case "get_entity_detail":
      return executeGetEntityDetail(surreal, ws, args.entityId as string);

    case "get_project_status":
      return executeGetProjectStatus(surreal, ws, args.projectId as string);

    case "get_conversation_history":
      return executeGetConversationHistory(surreal, ws, {
        query: args.query as string,
      });

    case "check_constraints":
      return executeCheckConstraints(surreal, ws, args.proposed_action as string);

    case "resolve_decision":
      return executeResolveDecisionReadOnly(surreal, ws, {
        question: args.question as string,
        project: args.project as string | undefined,
        feature: args.feature as string | undefined,
      });

    default:
      throw new Error(`Unknown brain read tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Write tool dispatch
// ---------------------------------------------------------------------------

async function dispatchWriteTool(
  toolName: string,
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
  context: BrainToolCallContext,
): Promise<unknown> {
  const now = new Date();
  const sessionRecord = new RecordId("agent_session", context.sessionId);

  switch (toolName) {
    case "create_provisional_decision": {
      const projectRecord = (args.context as { project?: string })?.project
        ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: ws, projectInput: (args.context as { project: string }).project })
        : undefined;
      const featureRecord = (args.context as { feature?: string })?.feature
        ? await resolveWorkspaceFeatureRecord({ surreal, workspaceRecord: ws, featureInput: (args.context as { feature: string }).feature })
        : undefined;

      const decisionRecord = await createDecisionRecord({
        surreal,
        summary: args.name as string,
        status: "provisional",
        now,
        workspaceRecord: ws,
        rationale: args.rationale as string,
        ...(args.options_considered ? { optionsConsidered: args.options_considered as string[] } : {}),
        decidedByName: "mcp",
        ...(projectRecord ? { projectRecord } : {}),
        ...(featureRecord ? { featureRecord } : {}),
      });

      return {
        decision_id: `decision:${decisionRecord.id as string}`,
        status: "provisional",
        review_required: true,
      };
    }

    case "create_question": {
      const projectRecord = (args.context as { project?: string })?.project
        ? await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: ws, projectInput: (args.context as { project: string }).project })
        : undefined;
      const featureRecord = (args.context as { feature?: string })?.feature
        ? await resolveWorkspaceFeatureRecord({ surreal, workspaceRecord: ws, featureInput: (args.context as { feature: string }).feature })
        : undefined;

      const questionRecord = await createQuestionRecord({
        surreal,
        text: args.text as string,
        status: "open",
        now,
        workspaceRecord: ws,
        ...(args.category ? { category: args.category as string } : {}),
        ...(args.priority ? { priority: args.priority as string } : {}),
        ...(args.assigned_to ? { assignedToName: args.assigned_to as string } : {}),
        ...(projectRecord ? { projectRecord } : {}),
        ...(featureRecord ? { featureRecord } : {}),
      });

      return {
        question_id: `question:${questionRecord.id as string}`,
        status: "open",
      };
    }

    case "create_observation": {
      const relatedRecord = (args.related_entity_id as string | undefined)
        ? parseRecordIdString(
            args.related_entity_id as string,
            ["project", "feature", "task", "decision", "question"],
          ) as RecordId<"project" | "feature" | "task" | "decision" | "question", string>
        : undefined;

      if (relatedRecord) {
        const scoped = await isEntityInWorkspace(surreal, ws, relatedRecord);
        if (!scoped) {
          throw new Error("related entity is outside the current workspace scope");
        }
      }

      const observationRecord = await createObservation({
        surreal,
        workspaceRecord: ws,
        text: args.text as string,
        severity: args.severity as "info" | "warning" | "conflict",
        ...(args.category ? { category: args.category as EntityCategory } : {}),
        sourceAgent: "mcp",
        now,
        sourceSessionRecord: sessionRecord,
        ...(relatedRecord ? { relatedRecords: [relatedRecord] } : {}),
      });

      return {
        observation_id: `observation:${observationRecord.id as string}`,
        severity: args.severity,
        status: "open",
      };
    }

    case "create_suggestion": {
      const targetTables = ["project", "feature", "task", "question", "decision"] as const;
      const targetRecord = (args.target_entity_id as string | undefined)
        ? parseRecordIdString(args.target_entity_id as string, [...targetTables])
        : undefined;

      if (targetRecord) {
        const scoped = await isEntityInWorkspace(surreal, ws, targetRecord);
        if (!scoped) {
          throw new Error("target entity is outside the current workspace scope");
        }
      }

      const evidenceTables = ["workspace", "project", "person", "feature", "task", "decision", "question", "observation"] as const;
      const evidenceRecords = (args.evidence_entity_ids as string[] | undefined)?.map((id) =>
        parseRecordIdString(id, [...evidenceTables]),
      );

      const suggestionRecord = await createSuggestion({
        surreal,
        workspaceRecord: ws,
        text: args.text as string,
        category: args.category as SuggestionCategory,
        rationale: args.rationale as string,
        suggestedBy: "mcp",
        confidence: args.confidence as number,
        now,
        sourceSessionRecord: sessionRecord,
        ...(targetRecord ? { targetRecord } : {}),
        ...(evidenceRecords ? { evidenceRecords } : {}),
      });

      return {
        suggestion_id: `suggestion:${suggestionRecord.id as string}`,
        text: args.text,
        category: args.category,
        rationale: args.rationale,
        confidence: args.confidence,
        status: "pending",
        ...(args.target_entity_id ? { target: args.target_entity_id } : {}),
      };
    }

    case "create_work_item":
      return dispatchCreateWorkItem(args, surreal, ws);

    case "edit_work_item":
      return dispatchEditWorkItem(args, surreal, ws);

    case "move_items_to_project":
      return dispatchMoveItemsToProject(args, surreal, ws);

    case "acknowledge_observation": {
      const observationRecord = parseRecordIdString(
        args.observation_id as string,
        ["observation"],
        "observation",
      );
      await acknowledgeObservation({ surreal, workspaceRecord: ws, observationRecord, now });
      return {
        observation_id: `observation:${observationRecord.id as string}`,
        status: "acknowledged",
      };
    }

    case "resolve_observation": {
      const observationRecord = parseRecordIdString(
        args.observation_id as string,
        ["observation"],
        "observation",
      );
      await resolveObservation({ surreal, workspaceRecord: ws, observationRecord, now });
      return {
        observation_id: `observation:${observationRecord.id as string}`,
        status: "resolved",
      };
    }

    case "suggest_work_items":
      return dispatchSuggestWorkItems(args, surreal, ws);

    default:
      throw new Error(`Unknown brain write tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Complex write tool helpers
// ---------------------------------------------------------------------------

const CLOSED_STATUSES = new Set(["done", "completed", "closed", "resolved", "superseded"]);

async function dispatchCreateWorkItem(
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
) {
  const now = new Date();
  const kind = args.kind as "task" | "feature" | "project";
  const title = args.title as string;
  const rationale = args.rationale as string;

  if (kind === "project") {
    const [wsRow] = await surreal.query<[{ name: string } | undefined]>(
      "SELECT name FROM ONLY $ws;",
      { ws },
    );
    if (wsRow && title.toLowerCase().trim() === wsRow.name.toLowerCase().trim()) {
      return {
        error: `"${title}" is the workspace name, not a project. Create the user's described items as projects instead.`,
      };
    }

    const projectRecord = await createProjectRecord({
      surreal,
      name: title,
      status: "active",
      now,
      workspaceRecord: ws,
    });

    await seedDescriptionEntry({ surreal, targetRecord: projectRecord, text: rationale }).catch(() => undefined);

    return {
      entity_id: `project:${projectRecord.id as string}`,
      kind: "project",
      title,
    };
  }

  if (kind === "task") {
    const entityId = randomUUID();
    const taskRecord = new RecordId("task", entityId);
    await surreal.create(taskRecord).content({
      title,
      status: "open",
      workspace: ws,
      ...(args.category ? { category: args.category } : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      created_at: now,
      updated_at: now,
    });

    if (args.project) {
      try {
        const projectRecord = await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: ws, projectInput: args.project as string });
        await surreal.relate(taskRecord, new RecordId("belongs_to", randomUUID()), projectRecord, { added_at: now }).output("after");
      } catch { /* project link failed, non-fatal */ }
    }

    if (args.feature) {
      try {
        const featureRecord = await resolveWorkspaceFeatureRecord({ surreal, workspaceRecord: ws, featureInput: args.feature as string });
        await surreal.relate(featureRecord, new RecordId("has_task", randomUUID()), taskRecord, { added_at: now }).output("after");
        await surreal.relate(taskRecord, new RecordId("belongs_to", randomUUID()), featureRecord, { added_at: now }).output("after");
      } catch { /* feature link failed, non-fatal */ }
    }

    await seedDescriptionEntry({ surreal, targetRecord: taskRecord, text: rationale }).catch(() => undefined);

    return { entity_id: `task:${entityId}`, kind: "task", title };
  }

  // feature
  const entityId = randomUUID();
  const featureRecord = new RecordId("feature", entityId);
  await surreal.create(featureRecord).content({
    name: title,
    status: "active",
    workspace: ws,
    ...(args.category ? { category: args.category } : {}),
    created_at: now,
    updated_at: now,
  });

  if (args.project) {
    try {
      const projectRecord = await resolveWorkspaceProjectRecord({ surreal, workspaceRecord: ws, projectInput: args.project as string });
      await ensureProjectFeatureEdge(surreal, projectRecord, featureRecord, now);
    } catch { /* project link failed, non-fatal */ }
  }

  await seedDescriptionEntry({ surreal, targetRecord: featureRecord, text: rationale }).catch(() => undefined);

  return { entity_id: `feature:${entityId}`, kind: "feature", title };
}

async function dispatchEditWorkItem(
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
) {
  const now = new Date();
  const workItemRecord = parseRecordIdString(args.id as string, ["task", "feature", "project"]);

  const inWorkspace = await isEntityInWorkspace(surreal, ws, workItemRecord);
  if (!inWorkspace) {
    throw new Error(`work item is not in workspace: ${args.id}`);
  }

  const tableName = workItemRecord.table.name;
  if (tableName !== "task" && tableName !== "feature" && tableName !== "project") {
    throw new Error(`unsupported entity type: ${tableName}`);
  }

  const patch: Record<string, unknown> = { updated_at: now };
  const updatedFields: string[] = [];

  if (args.title) {
    if (tableName === "task") {
      patch.title = args.title;
    } else {
      patch.name = args.title;
    }
    updatedFields.push("title");
  }

  if (args.status) {
    patch.status = args.status;
    updatedFields.push("status");
  }

  if (args.category) {
    if (tableName === "project") throw new Error("category is not editable on project");
    patch.category = args.category;
    updatedFields.push("category");
  }

  if (args.priority) {
    if (tableName !== "task") throw new Error("priority is only editable on task");
    patch.priority = args.priority;
    updatedFields.push("priority");
  }

  if (updatedFields.length === 0 && !args.rationale) {
    throw new Error("at least one editable field must be provided");
  }

  if (updatedFields.length > 0) {
    await surreal.update(workItemRecord).merge(patch);
  }

  if (args.rationale) {
    await seedDescriptionEntry({
      surreal,
      targetRecord: workItemRecord,
      text: args.rationale as string,
    });
  }

  const updatedName = await readEntityName(surreal, workItemRecord);

  return {
    entity_id: `${tableName}:${workItemRecord.id as string}`,
    kind: tableName,
    title: updatedName ?? (args.title as string) ?? args.id,
    updated_fields: updatedFields,
    ...(args.rationale ? { rationale_added: true } : {}),
  };
}

async function dispatchMoveItemsToProject(
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
) {
  const now = new Date();
  const entityIds = args.entity_ids as string[];

  let projectRecord: RecordId<"project", string>;
  try {
    projectRecord = await resolveWorkspaceProjectRecord({
      surreal,
      workspaceRecord: ws,
      projectInput: args.target_project as string,
    });
  } catch {
    return {
      error: `Target project not found: ${args.target_project}`,
      moved: [],
      failed: entityIds.map((id) => ({ entity_id: id, reason: "target project resolution failed" })),
    };
  }

  const moved: Array<{ entity_id: string; title: string }> = [];
  const failed: Array<{ entity_id: string; reason: string }> = [];

  for (const rawId of entityIds) {
    try {
      const entityRecord = parseRecordIdString(rawId, ["feature", "task"]);
      const table = entityRecord.table.name;

      const inWorkspace = await isEntityInWorkspace(surreal, ws, entityRecord);
      if (!inWorkspace) {
        failed.push({ entity_id: rawId, reason: "entity not found in workspace" });
        continue;
      }

      const title = await readEntityName(surreal, entityRecord) ?? rawId;

      if (table === "feature") {
        await surreal.query("DELETE FROM has_feature WHERE out = $feature;", { feature: entityRecord });
        await ensureProjectFeatureEdge(surreal, projectRecord, entityRecord as RecordId<"feature", string>, now);
        moved.push({ entity_id: rawId, title });
      } else if (table === "task") {
        await surreal.query("DELETE FROM belongs_to WHERE `in` = $task AND record::tb(out) = 'project';", { task: entityRecord });
        await surreal.relate(entityRecord, new RecordId("belongs_to", randomUUID()), projectRecord, { added_at: now }).output("after");
        moved.push({ entity_id: rawId, title });
      } else {
        failed.push({ entity_id: rawId, reason: `unsupported entity type: ${table}` });
      }
    } catch (err) {
      failed.push({ entity_id: rawId, reason: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return { moved, failed };
}

async function dispatchSuggestWorkItems(
  args: Record<string, unknown>,
  surreal: Surreal,
  ws: RecordId<"workspace", string>,
) {
  const items = args.items as Array<{
    kind: "task" | "feature" | "project";
    title: string;
    rationale: string;
    category?: string;
    project?: string;
    priority?: string;
  }>;

  const suggestions: Array<Record<string, unknown>> = [];
  const updated: Array<{ existing_id: string; title: string; changes: string }> = [];
  const discarded: Array<{ title: string; reason: string }> = [];

  for (const item of items) {
    const candidates = await searchEntitiesByBm25({
      surreal,
      workspaceRecord: ws,
      query: item.title,
      kinds: [item.kind],
      limit: 5,
    });

    const top = candidates[0];
    if (!top) {
      suggestions.push(item);
      continue;
    }

    const normalizedTopStatus = top.status ? top.status.trim().toLowerCase() : undefined;
    if (normalizedTopStatus && CLOSED_STATUSES.has(normalizedTopStatus)) {
      suggestions.push(item);
      continue;
    }

    const normalizedTopName = top.name.trim().toLowerCase();
    const normalizedTitle = item.title.trim().toLowerCase();

    if (normalizedTopName === normalizedTitle) {
      discarded.push({ title: item.title, reason: `Exact duplicate of existing item ${top.kind}:${top.id} (${top.name})` });
      continue;
    }

    updated.push({
      existing_id: `${top.kind}:${top.id}`,
      title: top.name,
      changes: `Merge context from suggested item '${item.title}'`,
    });
  }

  return { suggestions, updated, discarded };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a Brain-native tool call.
 * Read tools are dispatched directly. Write tools assume authorization
 * has already been verified by the caller.
 */
export async function handleBrainToolCall(
  toolName: string,
  args: Record<string, unknown>,
  isReadTool: boolean,
  context: BrainToolCallContext,
  deps: BrainToolCallDeps,
): Promise<ToolCallResult> {
  const ws = new RecordId("workspace", context.workspaceId);

  try {
    const result = isReadTool
      ? await dispatchReadTool(toolName, args, deps.surreal, ws)
      : await dispatchWriteTool(toolName, args, deps.surreal, ws, context);

    return { kind: "success", result };
  } catch (error) {
    return {
      kind: "error",
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
