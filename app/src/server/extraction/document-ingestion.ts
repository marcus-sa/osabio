import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { elapsedMs, logError, logInfo } from "../http/observability";
import { createEmbedding } from "./embedding-writeback";
import { extractStructuredGraph } from "./extract-graph";
import { splitDocumentIntoChunks } from "./markdown-chunker";
import { persistExtractionOutput } from "./persist-extraction";
import type { IncomingAttachment, PersistExtractionResult, SourceRecord } from "./types";

export async function ingestAttachment(input: {
  surreal: Surreal;
  extractionModel: any;
  embeddingModel: any;
  embeddingDimension: number;
  extractionStoreThreshold: number;
  extractionModelId: string;
  workspaceRecord: RecordId<"workspace", string>;
  conversationRecord: RecordId<"conversation", string>;
  userMessageRecord: RecordId<"message", string>;
  attachment: IncomingAttachment;
  now: Date;
}): Promise<PersistExtractionResult> {
  const startedAt = performance.now();
  const documentRecord = new RecordId("document", randomUUID());
  const workspaceId = input.workspaceRecord.id as string;
  const conversationId = input.conversationRecord.id as string;

  logInfo("attachment.ingest.started", "Attachment ingestion started", {
    workspaceId,
    conversationId,
    documentId: documentRecord.id as string,
    fileSizeBytes: input.attachment.sizeBytes,
  });

  try {
    await input.surreal.create(documentRecord).content({
      workspace: input.workspaceRecord,
      name: input.attachment.fileName,
      mime_type: input.attachment.mimeType,
      size_bytes: input.attachment.sizeBytes,
      uploaded_at: input.now,
    });

    const chunks = splitDocumentIntoChunks(input.attachment.content);
    const persistedEntities = [];
    const persistedRelationships = [];
    const seeds = [];
    const embeddingTargets = [];
    const tools = [];
    const unresolvedAssigneeNames = [];

    for (const chunk of chunks) {
      const chunkRecord = new RecordId("document_chunk", randomUUID());
      const chunkEmbedding = await createEmbedding(input.embeddingModel, input.embeddingDimension, chunk.content);

      await input.surreal.create(chunkRecord).content({
        document: documentRecord,
        workspace: input.workspaceRecord,
        content: chunk.content,
        ...(chunk.heading ? { section_heading: chunk.heading } : {}),
        position: chunk.position,
        ...(chunkEmbedding ? { embedding: chunkEmbedding } : {}),
        created_at: input.now,
      });

      const extraction = await extractStructuredGraph({
        extractionModel: input.extractionModel,
        conversationHistory: [],
        graphContext: [],
        sourceText: chunk.content,
        onboarding: true,
        heading: chunk.heading,
      });

      const result = await persistExtractionOutput({
        surreal: input.surreal,
        embeddingModel: input.embeddingModel,
        embeddingDimension: input.embeddingDimension,
        extractionModelId: input.extractionModelId,
        extractionStoreThreshold: input.extractionStoreThreshold,
        workspaceRecord: input.workspaceRecord,
        sourceRecord: chunkRecord as SourceRecord,
        sourceKind: "document_chunk",
        sourceLabel: chunk.heading ? `${input.attachment.fileName} · ${chunk.heading}` : input.attachment.fileName,
        promptText: chunk.content,
        output: extraction,
        sourceChunkRecord: chunkRecord,
        now: input.now,
      });

      persistedEntities.push(...result.entities);
      persistedRelationships.push(...result.relationships);
      seeds.push(...result.seeds);
      embeddingTargets.push(...result.embeddingTargets);
      tools.push(...result.tools);
      unresolvedAssigneeNames.push(...result.unresolvedAssigneeNames);
    }

    logInfo("attachment.ingest.completed", "Attachment ingestion completed", {
      workspaceId,
      conversationId,
      documentId: documentRecord.id as string,
      entityCount: persistedEntities.length,
      relationshipCount: persistedRelationships.length,
      chunkCount: chunks.length,
      durationMs: elapsedMs(startedAt),
    });

    return {
      entities: persistedEntities,
      relationships: persistedRelationships,
      seeds,
      embeddingTargets,
      tools,
      unresolvedAssigneeNames,
    };
  } catch (error) {
    logError("attachment.ingest.failed", "Attachment ingestion failed", error, {
      workspaceId,
      conversationId,
      documentId: documentRecord.id as string,
      durationMs: elapsedMs(startedAt),
    });
    throw error;
  }
}
