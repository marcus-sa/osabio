import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { tool } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES } from "../../../shared/contracts";
import { createEmbeddingVector } from "../../graph/embeddings";
import {
  createExtractionProvenanceEdge,
  createProjectRecord,
  resolveWorkspaceProjectRecord,
} from "../../graph/queries";
import { seedDescriptionEntry } from "../../descriptions/persist";
import { fireDescriptionUpdates } from "../../descriptions/triggers";
import { ensureProjectFeatureEdge } from "../../workspace/workspace-scope";
import { requireAuthorizedContext } from "../../iam/authority";
import { logError } from "../../http/observability";
import type { ChatToolDeps } from "./types";

export function createCreateWorkItemTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create a task, feature, or project directly in the knowledge graph. Use when the user explicitly requests creation (\"add a task for X\") or during onboarding entity seeding. For uncertain/brainstormed items, prefer suggest_work_items instead.",
    inputSchema: z.object({
      kind: z.enum(["task", "feature", "project"]).describe(
        "project: named product area or workstream (MUST create before features/tasks can belong to it). feature: capability within an existing project. task: concrete executable work with action verb. If no projects exist yet, create a project first.",
      ),
      title: z.string().min(1).describe("Concise entity title"),
      rationale: z.string().min(1).describe("Why this entity is needed — seeds the description"),
      category: z.enum(ENTITY_CATEGORIES).optional().describe("Category classification"),
      priority: z.enum(ENTITY_PRIORITIES).optional().describe("critical: blocking/urgent. high: important, needs attention soon. medium: normal priority. low: nice-to-have, deferred."),
      project: z.string().optional().describe("Project name to scope the entity under"),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_task", deps);
      const now = new Date();

      const embedding = await createEmbeddingVector(
        deps.embeddingModel,
        input.title,
        deps.embeddingDimension,
      );

      const entityId = randomUUID();

      // Hard guard: never create a project with the same name as the workspace
      if (input.kind === "project") {
        const [ws] = await deps.surreal.query<[{ name: string } | undefined]>(
          "SELECT name FROM ONLY $ws;",
          { ws: context.workspaceRecord },
        );
        if (ws && input.title.toLowerCase().trim() === ws.name.toLowerCase().trim()) {
          return {
            error: `"${input.title}" is the workspace name, not a project. Create the user's described items (e.g. Dashboard, Inventory) as projects instead.`,
          };
        }

        const projectRecord = await createProjectRecord({
          surreal: deps.surreal,
          name: input.title,
          status: "active",
          now,
          workspaceRecord: context.workspaceRecord,
          sourceMessageRecord: context.currentMessageRecord,
        });

        if (embedding) {
          await deps.surreal.update(projectRecord).merge({ embedding });
        }

        await seedDescriptionEntry({
          surreal: deps.surreal,
          targetRecord: projectRecord,
          text: input.rationale,
        }).catch(() => undefined);

        await createExtractionProvenanceEdge({
          surreal: deps.surreal,
          sourceRecord: context.currentMessageRecord,
          targetRecord: projectRecord,
          now,
          confidence: 0.95,
          model: deps.extractionModelId,
          fromText: input.title,
          evidence: context.latestUserText,
          evidenceSourceRecord: context.currentMessageRecord,
        });

        return {
          entity_id: `project:${projectRecord.id as string}`,
          kind: "project" as const,
          title: input.title,
        };
      }

      if (input.kind === "task") {
        const taskRecord = new RecordId("task", entityId);
        await deps.surreal.create(taskRecord).content({
          title: input.title,
          status: "open",
          workspace: context.workspaceRecord,
          ...(input.category ? { category: input.category } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(embedding ? { embedding } : {}),
          created_at: now,
          updated_at: now,
        });

        if (input.project) {
          try {
            const projectRecord = await resolveWorkspaceProjectRecord({
              surreal: deps.surreal,
              workspaceRecord: context.workspaceRecord,
              projectInput: input.project,
            });
            await deps.surreal
              .relate(taskRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
                added_at: now,
              })
              .output("after");
          } catch (err) {
            logError("create_work_item", `failed to link task to project "${input.project}"`, err);
          }
        }

        await seedDescriptionEntry({
          surreal: deps.surreal,
          targetRecord: taskRecord,
          text: input.rationale,
        }).catch(() => undefined);

        await createExtractionProvenanceEdge({
          surreal: deps.surreal,
          sourceRecord: context.currentMessageRecord,
          targetRecord: taskRecord,
          now,
          confidence: 0.95,
          model: deps.extractionModelId,
          fromText: input.title,
          evidence: context.latestUserText,
          evidenceSourceRecord: context.currentMessageRecord,
        });

        return {
          entity_id: `task:${entityId}`,
          kind: "task" as const,
          title: input.title,
        };
      }

      // feature
      const featureRecord = new RecordId("feature", entityId);
      await deps.surreal.create(featureRecord).content({
        name: input.title,
        status: "active",
        workspace: context.workspaceRecord,
        ...(input.category ? { category: input.category } : {}),
        ...(embedding ? { embedding } : {}),
        created_at: now,
        updated_at: now,
      });

      if (input.project) {
        try {
          const projectRecord = await resolveWorkspaceProjectRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            projectInput: input.project,
          });
          await ensureProjectFeatureEdge(deps.surreal, projectRecord, featureRecord, now);

          await fireDescriptionUpdates({
            surreal: deps.surreal,
            extractionModel: deps.extractionModel,
            trigger: {
              kind: "feature_created",
              entity: featureRecord,
              summary: `Feature added: ${input.title}`,
            },
          }).catch(() => undefined);
        } catch (err) {
          logError("create_work_item", `failed to link feature to project "${input.project}"`, err);
        }
      }

      await seedDescriptionEntry({
        surreal: deps.surreal,
        targetRecord: featureRecord,
        text: input.rationale,
      }).catch(() => undefined);

      await createExtractionProvenanceEdge({
        surreal: deps.surreal,
        sourceRecord: context.currentMessageRecord,
        targetRecord: featureRecord,
        now,
        confidence: 0.95,
        model: deps.extractionModelId,
        fromText: input.title,
        evidence: context.latestUserText,
        evidenceSourceRecord: context.currentMessageRecord,
      });

      return {
        entity_id: `feature:${entityId}`,
        kind: "feature" as const,
        title: input.title,
      };
    },
  });
}
