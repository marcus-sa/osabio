import { RecordId, type Surreal } from "surrealdb";
import { readEntityText } from "./entity-text";
import type {
  ConversationProvenanceRow,
  ExtractionConversationContext,
  ExtractionGraphContextRow,
  GraphEntityRecord,
  MessageContextRow,
} from "./types";

type ExtractableEntityKind = "project" | "person" | "feature" | "task" | "decision" | "question";

export async function loadAssistantConversationContext(
  surreal: Surreal,
  conversationId: string,
): Promise<MessageContextRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[MessageContextRow[]]>(
      "RETURN fn::conversation_recent($conversation, $limit);",
      {
        conversation: conversationRecord,
        limit: 10,
      },
    )
    .collect<[MessageContextRow[]]>();

  return [...rows].reverse();
}

export async function loadExtractionConversationContext(input: {
  surreal: Surreal;
  conversationId: string;
  currentMessageRecord: RecordId<"message", string>;
}): Promise<ExtractionConversationContext> {
  const conversationRecord = new RecordId("conversation", input.conversationId);
  const [rows] = await input.surreal
    .query<[MessageContextRow[]]>(
      "RETURN fn::conversation_recent($conversation, $limit);",
      {
        conversation: conversationRecord,
        limit: 31,
      },
    )
    .collect<[MessageContextRow[]]>();

  const ordered = [...rows].reverse();
  const currentMessage = ordered.find((row) => row.id.id === input.currentMessageRecord.id);
  if (!currentMessage) {
    throw new Error(`current message not found in conversation context: ${input.currentMessageRecord.id as string}`);
  }

  return {
    conversationHistory: ordered.filter((row) => row.id.id !== input.currentMessageRecord.id).slice(-30),
    currentMessage,
  };
}

export async function loadConversationGraphContext(
  surreal: Surreal,
  conversationId: string,
  limit: number,
  options?: { inheritedEntityIds?: RecordId[] },
): Promise<ExtractionGraphContextRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[ConversationProvenanceRow[]]>(
      [
        "SELECT `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation = $conversation)",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { conversation: conversationRecord, limit },
    )
    .collect<[ConversationProvenanceRow[]]>();

  const seen = new Set<string>();
  const items: ExtractionGraphContextRow[] = [];

  for (const row of rows) {
    const entityId = row.out.id as string;
    if (seen.has(entityId)) {
      continue;
    }

    const entityTable = row.out.tb;
    if (
      entityTable !== "project" &&
      entityTable !== "person" &&
      entityTable !== "feature" &&
      entityTable !== "task" &&
      entityTable !== "decision" &&
      entityTable !== "question"
    ) {
      continue;
    }

    const entityText = await readEntityText(surreal, row.out);
    if (!entityText) {
      continue;
    }

    items.push({
      id: row.out,
      kind: entityTable as ExtractableEntityKind,
      text: entityText,
      confidence: row.confidence,
      sourceMessage: row.in,
    });
    seen.add(entityId);
  }

  // Merge inherited entities from parent conversation when branch has sparse context
  if (options?.inheritedEntityIds && options.inheritedEntityIds.length > 0 && items.length < 5) {
    const [inheritedRows] = await surreal
      .query<[ConversationProvenanceRow[]]>(
        [
          "SELECT `in`, out, confidence, extracted_at",
          "FROM extraction_relation",
          "WHERE out IN $entityIds",
          "ORDER BY extracted_at DESC",
          "LIMIT $limit;",
        ].join(" "),
        { entityIds: options.inheritedEntityIds, limit },
      )
      .collect<[ConversationProvenanceRow[]]>();

    for (const row of inheritedRows) {
      const entityId = row.out.id as string;
      if (seen.has(entityId)) continue;

      const entityTable = row.out.tb;
      if (
        entityTable !== "project" &&
        entityTable !== "person" &&
        entityTable !== "feature" &&
        entityTable !== "task" &&
        entityTable !== "decision" &&
        entityTable !== "question"
      ) {
        continue;
      }

      const entityText = await readEntityText(surreal, row.out);
      if (!entityText) continue;

      items.push({
        id: row.out,
        kind: entityTable as ExtractableEntityKind,
        text: entityText,
        confidence: row.confidence,
        sourceMessage: row.in,
      });
      seen.add(entityId);
    }
  }

  return items;
}

export async function loadWorkspaceGraphContext(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  limit: number,
): Promise<ExtractionGraphContextRow[]> {
  const [rows] = await surreal
    .query<[
      Array<{
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        out: GraphEntityRecord;
        confidence: number;
        extracted_at: Date | string;
      }>,
    ]>(
      [
        "SELECT `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE `in` IN (",
        "  SELECT VALUE id FROM message",
        "  WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
        ")",
        "OR `in` IN (SELECT VALUE id FROM document_chunk WHERE workspace = $workspace)",
        "OR `in` IN (SELECT VALUE id FROM git_commit WHERE workspace = $workspace)",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: workspaceRecord, limit },
    )
    .collect<[
      Array<{
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        out: GraphEntityRecord;
        confidence: number;
        extracted_at: Date | string;
      }>,
    ]>();

  const seen = new Set<string>();
  const items: ExtractionGraphContextRow[] = [];

  for (const row of rows) {
    const entityId = row.out.id as string;
    if (seen.has(entityId)) continue;

    const entityTable = row.out.tb;
    if (
      entityTable !== "project" &&
      entityTable !== "person" &&
      entityTable !== "feature" &&
      entityTable !== "task" &&
      entityTable !== "decision" &&
      entityTable !== "question"
    ) {
      continue;
    }

    const entityText = await readEntityText(surreal, row.out);
    if (!entityText) continue;

    items.push({
      id: row.out,
      kind: entityTable as ExtractableEntityKind,
      text: entityText,
      confidence: row.confidence,
      sourceMessage: row.in as RecordId<"message", string>,
    });
    seen.add(entityId);
  }

  return items;
}
