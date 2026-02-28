import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import type { EntityKind, ExtractedEntity, ExtractedRelationship, OnboardingSeedItem, SourceKind } from "../../shared/contracts";
import { resolveValidatedResolvedFromMessageId } from "./provenance";
import type { ExtractionPromptEntity, ExtractionPromptOutput } from "./schema";
import {
  appendWorkspaceTools,
  normalizeRelationshipKind,
  upsertGraphEntity,
} from "./entity-upsert";
import { findWorkspacePersonByName, resolvePersonAttributionPatch } from "./person";
import type {
  GraphEntityRecord,
  PersistExtractionResult,
  SourceRecord,
  TempEntityReference,
} from "./types";
import { elapsedMs, logError, logInfo } from "../http/observability";
import { loadWorkspaceProjects } from "../workspace/workspace-scope";
import { postValidateEntities, postValidateRelationships } from "./validation";

export async function persistExtractionOutput(input: {
  surreal: Surreal;
  embeddingModel: any;
  embeddingDimension: number;
  extractionModelId: string;
  extractionStoreThreshold: number;
  workspaceRecord: RecordId<"workspace", string>;
  sourceRecord: SourceRecord;
  sourceKind: SourceKind;
  sourceLabel?: string;
  promptText: string;
  output: ExtractionPromptOutput;
  sourceMessageRecord?: RecordId<"message", string>;
  sourceChunkRecord?: RecordId<"document_chunk", string>;
  extractionHistoryMessageIds?: string[];
  now: Date;
}): Promise<PersistExtractionResult> {
  const startedAt = performance.now();
  logInfo("extraction.persist.started", "Extraction persistence started", {
    workspaceId: input.workspaceRecord.id as string,
    sourceKind: input.sourceKind,
    sourceId: input.sourceRecord.id as string,
    candidateEntityCount: input.output.entities.length,
    candidateRelationshipCount: input.output.relationships.length,
  });

  try {
    const entities = postValidateEntities({
      entities: input.output.entities,
      sourceText: input.promptText,
      storeThreshold: input.extractionStoreThreshold,
    });
    if (input.sourceKind === "message" && !input.sourceMessageRecord) {
      throw new Error("message extraction persistence requires sourceMessageRecord");
    }

    const extractionHistoryMessageIds = new Set(input.extractionHistoryMessageIds ?? []);
    const relationships = postValidateRelationships({
      relationships: input.output.relationships,
      storeThreshold: input.extractionStoreThreshold,
    }).map((relationship) => ({
      ...relationship,
      kind: normalizeRelationshipKind(relationship.kind),
    }));

    const persistedEntities: ExtractedEntity[] = [];
    const persistedRelationships: ExtractedRelationship[] = [];
    const seeds: OnboardingSeedItem[] = [];
    const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
    const entityByTempId = new Map<string, TempEntityReference>();
    const unresolvedAssigneeNames = new Set<string>();

    const workspaceProjects = await loadWorkspaceProjects(input.surreal, input.workspaceRecord);

    for (const extracted of entities) {
      const resolvedFromMessageId = resolveValidatedResolvedFromMessageId({
        resolvedFromMessageId: "resolvedFromMessageId" in extracted ? extracted.resolvedFromMessageId : undefined,
        sourceKind: input.sourceKind,
        sourceMessageId: input.sourceMessageRecord?.id as string | undefined,
        extractionHistoryMessageIds,
      });
      const resolvedFromMessageRecord = resolvedFromMessageId
        ? new RecordId("message", resolvedFromMessageId)
        : undefined;

      const persisted = await upsertGraphEntity({
        surreal: input.surreal,
        embeddingModel: input.embeddingModel,
        embeddingDimension: input.embeddingDimension,
        extractionModelId: input.extractionModelId,
        workspaceRecord: input.workspaceRecord,
        workspaceProjects,
        sourceRecord: input.sourceRecord,
        sourceKind: input.sourceKind,
        promptText: input.promptText,
        extracted: extracted as ExtractionPromptEntity & { kind: Exclude<EntityKind, "workspace" | "person"> },
        sourceMessageRecord: input.sourceMessageRecord,
        sourceChunkRecord: input.sourceChunkRecord,
        resolvedFromMessageRecord,
        now: input.now,
      });

      entityByTempId.set(extracted.tempId, {
        record: persisted.record,
        text: persisted.text,
        id: persisted.record.id as string,
        kind: persisted.kind,
      });

      const extractedCategory = "category" in extracted ? extracted.category : undefined;

      persistedEntities.push({
        id: persisted.record.id as string,
        kind: persisted.kind,
        text: persisted.text,
        confidence: extracted.confidence,
        sourceKind: input.sourceKind,
        sourceId: input.sourceRecord.id as string,
        ...(extractedCategory ? { category: extractedCategory } : {}),
      });

      seeds.push({
        id: persisted.record.id as string,
        kind: persisted.kind,
        text: persisted.text,
        confidence: extracted.confidence,
        sourceKind: input.sourceKind,
        sourceId: input.sourceRecord.id as string,
        ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
        ...(extractedCategory ? { category: extractedCategory } : {}),
      });

      if (persisted.created) {
        embeddingTargets.push({
          record: persisted.record,
          text: persisted.text,
        });
      }

      const assigneeName = "assignee_name" in extracted ? extracted.assignee_name : undefined;
      if (assigneeName) {
        const attribution = await applyAssigneeReference({
          surreal: input.surreal,
          workspaceRecord: input.workspaceRecord,
          entityRecord: persisted.record,
          entityKind: persisted.kind,
          assigneeName,
          now: input.now,
        });

        if (!attribution.resolved) {
          unresolvedAssigneeNames.add(attribution.assigneeName);
        }
      }
    }

    for (const relationship of relationships) {
      const from = entityByTempId.get(relationship.fromTempId);
      const to = entityByTempId.get(relationship.toTempId);
      if (!from || !to) {
        continue;
      }

      const relationRecord = new RecordId("entity_relation", randomUUID());
      await input.surreal.relate(from.record, relationRecord, to.record, {
        kind: relationship.kind,
        confidence: relationship.confidence,
        ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
        ...(input.sourceChunkRecord ? { source_chunk: input.sourceChunkRecord } : {}),
        extracted_at: input.now,
        created_at: input.now,
        from_text: relationship.fromText,
        to_text: relationship.toText,
      }).output("after");

      persistedRelationships.push({
        id: relationRecord.id as string,
        kind: relationship.kind,
        fromId: from.id,
        toId: to.id,
        confidence: relationship.confidence,
        sourceKind: input.sourceKind,
        sourceId: input.sourceRecord.id as string,
        ...(input.sourceMessageRecord ? { sourceMessageId: input.sourceMessageRecord.id as string } : {}),
        fromText: relationship.fromText,
        toText: relationship.toText,
      });
    }

    logInfo("extraction.persist.completed", "Extraction persistence completed", {
      workspaceId: input.workspaceRecord.id as string,
      sourceKind: input.sourceKind,
      sourceId: input.sourceRecord.id as string,
      persistedEntityCount: persistedEntities.length,
      persistedRelationshipCount: persistedRelationships.length,
      seedCount: seeds.length,
      toolCount: input.output.tools.length,
      unresolvedAssigneeCount: unresolvedAssigneeNames.size,
      durationMs: elapsedMs(startedAt),
    });

    return {
      entities: persistedEntities,
      relationships: persistedRelationships,
      seeds,
      embeddingTargets,
      tools: input.output.tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0),
      unresolvedAssigneeNames: [...unresolvedAssigneeNames],
    };
  } catch (error) {
    logError("extraction.persist.failed", "Extraction persistence failed", error, {
      workspaceId: input.workspaceRecord.id as string,
      sourceKind: input.sourceKind,
      sourceId: input.sourceRecord.id as string,
      durationMs: elapsedMs(startedAt),
    });
    throw error;
  }
}

async function applyAssigneeReference(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  entityRecord: GraphEntityRecord;
  entityKind: Exclude<EntityKind, "workspace" | "person">;
  assigneeName: string;
  now: Date;
}): Promise<{ resolved: boolean; assigneeName: string }> {
  const assigneeName = input.assigneeName.trim();
  if (assigneeName.length === 0) {
    return { resolved: true, assigneeName };
  }

  const personRecord = await findWorkspacePersonByName({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    personName: assigneeName,
  });

  const patch = resolvePersonAttributionPatch({
    targetKind: input.entityKind,
    assigneeName,
    ...(personRecord ? { personRecordId: personRecord.id as string } : {}),
  });

  if (patch.kind === "feature") {
    if (patch.field === "owner" && personRecord) {
      await input.surreal.update(input.entityRecord as RecordId<"feature", string>).merge({
        owner: personRecord,
        updated_at: input.now,
      });
      return { resolved: true, assigneeName };
    }

    await input.surreal.update(input.entityRecord as RecordId<"feature", string>).merge({
      owner_name: patch.value,
      updated_at: input.now,
    });
    return { resolved: false, assigneeName };
  }

  if (patch.kind === "task") {
    if (patch.field === "owner" && personRecord) {
      await input.surreal.update(input.entityRecord as RecordId<"task", string>).merge({
        owner: personRecord,
        updated_at: input.now,
      });
      return { resolved: true, assigneeName };
    }

    await input.surreal.update(input.entityRecord as RecordId<"task", string>).merge({
      owner_name: patch.value,
      updated_at: input.now,
    });
    return { resolved: false, assigneeName };
  }

  if (patch.kind === "decision") {
    if (patch.field === "decided_by" && personRecord) {
      await input.surreal.update(input.entityRecord as RecordId<"decision", string>).merge({
        decided_by: personRecord,
        updated_at: input.now,
      });
      return { resolved: true, assigneeName };
    }

    await input.surreal.update(input.entityRecord as RecordId<"decision", string>).merge({
      decided_by_name: patch.value,
      updated_at: input.now,
    });
    return { resolved: false, assigneeName };
  }

  if (patch.field === "assigned_to" && personRecord) {
    await input.surreal.update(input.entityRecord as RecordId<"question", string>).merge({
      assigned_to: personRecord,
      updated_at: input.now,
    });
    return { resolved: true, assigneeName };
  }

  await input.surreal.update(input.entityRecord as RecordId<"question", string>).merge({
    assigned_to_name: patch.value,
    updated_at: input.now,
  });
  return { resolved: false, assigneeName };
}

export async function appendExtractedTools(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  extractedTools: string[],
  now: Date,
): Promise<void> {
  const dedupedTools = [...new Set(extractedTools.map((tool) => tool.trim()).filter((tool) => tool.length > 0))];
  if (extractedTools.length > 0 && dedupedTools.length > 0) {
    await appendWorkspaceTools(surreal, workspaceRecord, dedupedTools, now);
  }
}
