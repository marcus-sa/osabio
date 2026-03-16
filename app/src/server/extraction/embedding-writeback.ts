import { embed } from "ai";
import { type RecordId, type Surreal } from "surrealdb";
import { elapsedMs } from "../http/observability";
import type { GraphEntityRecord } from "./types";
import { log } from "../telemetry/logger";

export async function persistEmbeddings(input: {
  surreal: Surreal;
  embeddingModel: any;
  embeddingDimension: number;
  assistantMessageRecord: RecordId<"message", string>;
  assistantText: string;
  entities: Array<{ record: GraphEntityRecord; text: string }>;
}): Promise<void> {
  const startedAt = performance.now();
  log.info("embedding.persist.started", "Embedding persistence started", {
    messageId: input.assistantMessageRecord.id as string,
    entityCount: input.entities.length,
  });

  try {
    const messageEmbedding = await createEmbedding(input.embeddingModel, input.embeddingDimension, input.assistantText);
    if (messageEmbedding) {
      await writeEmbedding({
        surreal: input.surreal,
        record: input.assistantMessageRecord,
        embedding: messageEmbedding,
        label: "assistant message",
      });
    }

    let embeddedEntityCount = 0;
    for (const entity of input.entities) {
      const entityEmbedding = await createEmbedding(input.embeddingModel, input.embeddingDimension, entity.text);
      if (!entityEmbedding) {
        continue;
      }

      await writeEmbedding({
        surreal: input.surreal,
        record: entity.record as RecordId<string, string>,
        embedding: entityEmbedding,
        label: `${entity.record.table.name}:${entity.record.id as string}`,
      });
      embeddedEntityCount += 1;
    }

    log.info("embedding.persist.completed", "Embedding persistence completed", {
      messageId: input.assistantMessageRecord.id as string,
      entityCount: input.entities.length,
      embeddedEntityCount,
      durationMs: elapsedMs(startedAt),
    });
  } catch (error) {
    log.error("embedding.persist.failed", "Embedding persistence failed", error, {
      messageId: input.assistantMessageRecord.id as string,
      entityCount: input.entities.length,
      durationMs: elapsedMs(startedAt),
    });
    throw error;
  }
}

export async function createEmbedding(
  embeddingModel: any,
  embeddingDimension: number,
  value: string,
): Promise<number[] | undefined> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const result = await embed({
    model: embeddingModel,
    value: normalized,
  });

  if (result.embedding.length !== embeddingDimension) {
    log.warn("embedding.dimension_mismatch", "Skipping embedding write due to vector dimension mismatch", {
      actualDimension: result.embedding.length,
      configuredDimension: embeddingDimension,
    });
    return undefined;
  }

  return result.embedding;
}

async function writeEmbedding(input: {
  surreal: Surreal;
  record: RecordId<string, string>;
  embedding: number[];
  label: string;
}): Promise<void> {
  const [updateResult] = await input.surreal
    .query<[unknown]>(
      "UPDATE $record MERGE $patch RETURN AFTER;",
      {
        record: input.record,
        patch: { embedding: input.embedding },
      },
    )
    .collect<[unknown]>();

  if (queryResultHasRecordId(updateResult)) {
    return;
  }

  const verified = await verifyEmbeddingPresent(input.surreal, input.record, input.embedding.length);
  if (!verified) {
    throw new Error(`${input.label} embedding update verification failed`);
  }

  log.warn(
    "embedding.persist.unexpected_update_output",
    "embedding update returned no row but verification succeeded",
    { record: input.label },
  );
}

async function verifyEmbeddingPresent(
  surreal: Surreal,
  record: RecordId<string, string>,
  expectedDimension: number,
): Promise<boolean> {
  const [queryResult] = await surreal
    .query<[unknown]>("SELECT id, embedding FROM $record;", { record })
    .collect<[unknown]>();
  const row = extractRecordFromPayload(queryResult);
  if (!row || row.id === undefined) {
    return false;
  }

  const vectorLength = readVectorLength(row.embedding);
  return vectorLength === expectedDimension;
}

function queryResultHasRecordId(result: unknown): boolean {
  return flattenQueryResult(result).some((candidate) => {
    if (!candidate || typeof candidate !== "object" || !("id" in candidate)) {
      return false;
    }
    return (candidate as { id?: unknown }).id !== undefined;
  });
}

function extractRecordFromPayload(value: unknown):
  | { id?: unknown; embedding?: unknown }
  | undefined {
  const candidates = flattenQueryResult(value).filter((entry) => entry && typeof entry === "object");
  const withId = candidates.find((entry) => "id" in (entry as Record<string, unknown>));
  if (withId) {
    return withId as { id?: unknown; embedding?: unknown };
  }

  const first = candidates[0];
  return first ? (first as { id?: unknown; embedding?: unknown }) : undefined;
}

function flattenQueryResult(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [value];
  }

  const flattened: unknown[] = [];
  for (const entry of value) {
    if (Array.isArray(entry)) {
      flattened.push(...flattenQueryResult(entry));
      continue;
    }
    flattened.push(entry);
  }

  return flattened;
}

function readVectorLength(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (ArrayBuffer.isView(value)) {
    const arrayLike = value as { length?: number };
    if (typeof arrayLike.length === "number") {
      return arrayLike.length;
    }
  }

  if (value && typeof value === "object" && Symbol.iterator in value) {
    const iterator = (value as { [Symbol.iterator]?: () => Iterator<unknown> })[Symbol.iterator];
    if (typeof iterator === "function") {
      return [...(value as Iterable<unknown>)].length;
    }
  }

  return undefined;
}
