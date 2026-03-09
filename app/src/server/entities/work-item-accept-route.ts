import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import { createEmbeddingVector } from "../graph/embeddings";
import { createProjectRecord, resolveWorkspaceProjectRecord } from "../graph/queries";
import { ensureProjectFeatureEdge } from "../workspace/workspace-scope";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import type { ServerDependencies } from "../runtime/types";
import { seedDescriptionEntry } from "../descriptions/persist";
import { fireDescriptionUpdates } from "../descriptions/triggers";

const acceptWorkItemSchema = z.object({
  kind: z.enum(["task", "feature", "project"]),
  title: z.string().min(1),
  rationale: z.string().min(1),
  project: z.string().optional(),
  priority: z.enum(ENTITY_PRIORITIES).optional(),
  category: z.enum(ENTITY_CATEGORIES).optional(),
});

export function createWorkItemAcceptHandler(
  deps: ServerDependencies,
): (workspaceId: string, request: Request) => Promise<Response> {
  return (workspaceId: string, request: Request) =>
    handleAcceptWorkItem(deps, workspaceId, request);
}

async function handleAcceptWorkItem(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const parsed = acceptWorkItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(`invalid work item: ${parsed.error.message}`, 400);
  }

  const item = parsed.data;

  let workspaceRecord: RecordId<"workspace", string>;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    logError("work-item.accept.workspace_resolve.failed", "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  try {
    const now = new Date();
    const embedding = await createEmbeddingVector(
      deps.embeddingModel,
      item.title,
      deps.config.embeddingDimension,
    );

    const entityId = randomUUID();

    if (item.kind === "task") {
      const taskRecord = new RecordId("task", entityId);
      await deps.surreal.create(taskRecord).content({
        title: item.title,
        status: "todo",
        workspace: workspaceRecord,
        ...(item.category ? { category: item.category } : {}),
        ...(item.priority ? { priority: item.priority } : {}),
        ...(embedding ? { embedding } : {}),
        created_at: now,
        updated_at: now,
      });

      if (item.project) {
        try {
          const projectRecord = await resolveWorkspaceProjectRecord({
            surreal: deps.surreal,
            workspaceRecord,
            projectInput: item.project,
          });
          await deps.surreal
            .relate(taskRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
              added_at: now,
            })
            .output("after");
        } catch {
          // project resolution is best-effort; task still created
        }
      }

      deps.inflight.track(seedDescriptionEntry({
        surreal: deps.surreal,
        targetRecord: taskRecord,
        text: item.rationale,
      }).catch(() => undefined));

      logInfo("work-item.accept.task.created", "Task created from work item suggestion", {
        workspaceId,
        entityId,
        title: item.title,
      });

      return jsonResponse({ entityId: `task:${entityId}` }, 201);
    }

    if (item.kind === "project") {
      const projectRecord = await createProjectRecord({
        surreal: deps.surreal,
        name: item.title,
        status: "active",
        now,
        workspaceRecord,
      });

      if (embedding) {
        await deps.surreal.update(projectRecord).merge({ embedding });
      }

      deps.inflight.track(seedDescriptionEntry({
        surreal: deps.surreal,
        targetRecord: projectRecord,
        text: item.rationale,
      }).catch(() => undefined));

      logInfo("work-item.accept.project.created", "Project created from work item suggestion", {
        workspaceId,
        entityId: projectRecord.id as string,
        title: item.title,
      });

      return jsonResponse({ entityId: `project:${projectRecord.id as string}` }, 201);
    }

    // feature
    const featureRecord = new RecordId("feature", entityId);
    await deps.surreal.create(featureRecord).content({
      name: item.title,
      status: "active",
      workspace: workspaceRecord,
      ...(item.category ? { category: item.category } : {}),
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    });

    if (item.project) {
      try {
        const projectRecord = await resolveWorkspaceProjectRecord({
          surreal: deps.surreal,
          workspaceRecord,
          projectInput: item.project,
        });
        await ensureProjectFeatureEdge(deps.surreal, projectRecord, featureRecord, now);

        deps.inflight.track(fireDescriptionUpdates({
          surreal: deps.surreal,
          extractionModel: deps.extractionModel,
          trigger: {
            kind: "feature_created",
            entity: featureRecord,
            summary: `Feature added: ${item.title}`,
          },
        }).catch(() => undefined));
      } catch {
        // project resolution is best-effort; feature still created
      }
    }

    deps.inflight.track(seedDescriptionEntry({
      surreal: deps.surreal,
      targetRecord: featureRecord,
      text: item.rationale,
    }).catch(() => undefined));

    logInfo("work-item.accept.feature.created", "Feature created from work item suggestion", {
      workspaceId,
      entityId,
      title: item.title,
    });

    return jsonResponse({ entityId: `feature:${entityId}` }, 201);
  } catch (error) {
    logError("work-item.accept.failed", "Failed to accept work item", error, {
      workspaceId,
      kind: item.kind,
      title: item.title,
    });
    const message = error instanceof Error ? error.message : "work item accept failed";
    return jsonError(message, 500);
  }
}
