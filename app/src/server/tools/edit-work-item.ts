import { tool } from "ai";
import { z } from "zod";
import {
  createExtractionProvenanceEdge,
  isEntityInWorkspace,
  parseRecordIdString,
  readEntityName,
} from "../graph/queries";
import { requireAuthorizedContext } from "../iam/authority";
import { editWorkItemSchema } from "../mcp/osabio-tool-definitions";
import { seedDescriptionEntry } from "../descriptions/persist";
import type { ChatToolDeps } from "./types";

const editableWorkItemTableSchema = z.enum(["task", "feature", "project"]);

export function createEditWorkItemTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Edit an existing task/feature/project by id. Use for rename or metadata updates. Do NOT use this to create new entities.",
    inputSchema: editWorkItemSchema,
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_task", deps);
      const now = new Date();
      const workItemRecord = parseRecordIdString(input.id, ["task", "feature", "project"]);

      const inWorkspace = await isEntityInWorkspace(
        deps.surreal,
        context.workspaceRecord,
        workItemRecord,
      );
      if (!inWorkspace) {
        throw new Error(`work item is not in workspace: ${input.id}`);
      }

      const tableName = editableWorkItemTableSchema.parse(workItemRecord.table.name);
      const patch: Record<string, unknown> = { updated_at: now };
      const updatedFields: string[] = [];

      if (input.title) {
        if (tableName === "task") {
          patch.title = input.title;
        } else {
          patch.name = input.title;
        }
        updatedFields.push("title");
      }

      if (input.status) {
        patch.status = input.status;
        updatedFields.push("status");
      }

      if (input.category) {
        if (tableName === "project") {
          throw new Error("category is not editable on project");
        }
        patch.category = input.category;
        updatedFields.push("category");
      }

      if (input.priority) {
        if (tableName !== "task") {
          throw new Error("priority is only editable on task");
        }
        patch.priority = input.priority;
        updatedFields.push("priority");
      }

      if (updatedFields.length === 0 && !input.rationale) {
        throw new Error("at least one editable field must be provided");
      }

      if (updatedFields.length > 0) {
        await deps.surreal.update(workItemRecord).merge(patch);
      }

      if (input.rationale) {
        await seedDescriptionEntry({
          surreal: deps.surreal,
          targetRecord: workItemRecord,
          text: input.rationale,
        });
      }

      await createExtractionProvenanceEdge({
        surreal: deps.surreal,
        sourceRecord: context.currentMessageRecord,
        targetRecord: workItemRecord,
        now,
        confidence: 0.95,
        model: deps.extractionModelId,
        fromText: input.title ?? input.id,
        evidence: context.latestUserText,
        evidenceSourceRecord: context.currentMessageRecord,
      });

      const updatedName = await readEntityName(deps.surreal, workItemRecord);

      return {
        entity_id: `${tableName}:${workItemRecord.id as string}`,
        kind: tableName,
        title: updatedName ?? input.title ?? input.id,
        updated_fields: updatedFields,
        ...(input.rationale ? { rationale_added: true } : {}),
      };
    },
  });
}
