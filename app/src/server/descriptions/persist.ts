import type { RecordId, Surreal } from "surrealdb";
import { logError, logInfo } from "../http/observability";
import { synthesizeDescription } from "./generate";
import type { DescriptionEntry, DescriptionTarget } from "./types";

type EntityWithDescriptionEntries = {
  name?: string;
  title?: string;
  description_entries?: DescriptionEntry[];
};

function resolveEntityName(row: EntityWithDescriptionEntries): string {
  return row.name ?? row.title ?? "Unknown";
}

export async function appendDescriptionEntry(input: {
  surreal: Surreal;
  extractionModel: any;
  targetRecord: RecordId;
  targetType: DescriptionTarget;
  entry: DescriptionEntry;
}): Promise<void> {
  const [rows] = await input.surreal
    .query<[EntityWithDescriptionEntries[]]>(
      "SELECT name, title, description_entries FROM $record LIMIT 1;",
      { record: input.targetRecord },
    )
    .collect<[EntityWithDescriptionEntries[]]>();

  const existing = rows[0];
  if (!existing) {
    logError("description.append.entity_not_found", "Target entity not found", undefined, {
      targetRecord: `${input.targetRecord.table}:${input.targetRecord.id}`,
    });
    return;
  }

  const entries = [...(existing.description_entries ?? []), input.entry];
  const entityName = resolveEntityName(existing);

  let description: string;
  if (entries.length === 1) {
    description = input.entry.text;
  } else {
    description = await synthesizeDescription({
      extractionModel: input.extractionModel,
      entityName,
      entityType: input.targetType,
      entries,
    });
  }

  await input.surreal.update(input.targetRecord).merge({
    description,
    description_entries: entries,
    updated_at: new Date(),
  });

  logInfo("description.append.success", "Description entry appended", {
    targetRecord: `${input.targetRecord.table}:${input.targetRecord.id}`,
    entryCount: entries.length,
  });
}

export async function seedDescriptionEntry(input: {
  surreal: Surreal;
  targetRecord: RecordId;
  text: string;
  source?: RecordId;
}): Promise<void> {
  const entry: DescriptionEntry = {
    text: input.text,
    ...(input.source ? { source: input.source } : {}),
    created_at: new Date(),
  };

  await input.surreal.update(input.targetRecord).merge({
    description: input.text,
    description_entries: [entry],
    updated_at: new Date(),
  });

  logInfo("description.seed.success", "Description seeded", {
    targetRecord: `${input.targetRecord.table}:${input.targetRecord.id}`,
  });
}
