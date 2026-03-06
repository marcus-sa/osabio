import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { tool } from "ai";
import { z } from "zod";
import {
  parseRecordIdString,
  readEntityName,
  resolveWorkspaceProjectRecord,
  isEntityInWorkspace,
} from "../../graph/queries";
import { ensureProjectFeatureEdge } from "../../workspace/workspace-scope";
import { requireAuthorizedContext } from "../../iam/authority";
import type { ChatToolDeps } from "./types";

type MoveResult = {
  entity_id: string;
  title: string;
};

type MoveFailure = {
  entity_id: string;
  reason: string;
};

export function createMoveItemsToProjectTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Move existing features or tasks to a different project. Use when reorganizing — e.g. user says items belong under a different project. Deletes the old project edge and creates a new one. Does NOT duplicate entities.",
    inputSchema: z.object({
      entity_ids: z
        .array(z.string().min(1))
        .min(1)
        .describe("Polymorphic entity IDs to move, e.g. ['feature:uuid', 'task:uuid']"),
      target_project: z
        .string()
        .min(1)
        .describe("Target project name or 'project:uuid' to move entities into"),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_task", deps);
      const now = new Date();

      let projectRecord: RecordId<"project", string>;
      try {
        projectRecord = await resolveWorkspaceProjectRecord({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          projectInput: input.target_project,
        });
      } catch (err) {
        return {
          error: `Target project not found: ${input.target_project}`,
          moved: [],
          failed: input.entity_ids.map((id) => ({ entity_id: id, reason: "target project resolution failed" })),
        };
      }

      const moved: MoveResult[] = [];
      const failed: MoveFailure[] = [];

      for (const rawId of input.entity_ids) {
        try {
          const entityRecord = parseRecordIdString(rawId, ["feature", "task"]);
          const table = entityRecord.table.name;

          const inWorkspace = await isEntityInWorkspace(
            deps.surreal,
            context.workspaceRecord,
            entityRecord,
          );
          if (!inWorkspace) {
            failed.push({ entity_id: rawId, reason: "entity not found in workspace" });
            continue;
          }

          const title = await readEntityName(deps.surreal, entityRecord) ?? rawId;

          if (table === "feature") {
            // Delete old has_feature edges (project → feature)
            await deps.surreal.query(
              "DELETE FROM has_feature WHERE out = $feature;",
              { feature: entityRecord },
            );

            // Create new has_feature edge to target project
            await ensureProjectFeatureEdge(
              deps.surreal,
              projectRecord,
              entityRecord as RecordId<"feature", string>,
              now,
            );

            moved.push({ entity_id: rawId, title });
          } else if (table === "task") {
            // Delete old belongs_to edges to projects only (preserve feature edges)
            await deps.surreal.query(
              "DELETE FROM belongs_to WHERE `in` = $task AND record::tb(out) = 'project';",
              { task: entityRecord },
            );

            // Create new belongs_to edge to target project
            await deps.surreal
              .relate(
                entityRecord,
                new RecordId("belongs_to", randomUUID()),
                projectRecord,
                { added_at: now },
              )
              .output("after");

            moved.push({ entity_id: rawId, title });
          } else {
            failed.push({ entity_id: rawId, reason: `unsupported entity type: ${table}` });
          }
        } catch (err) {
          failed.push({
            entity_id: rawId,
            reason: err instanceof Error ? err.message : "unknown error",
          });
        }
      }

      return { moved, failed };
    },
  });
}
