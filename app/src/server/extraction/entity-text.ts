import { RecordId, type Surreal } from "surrealdb";
import type { GraphEntityRecord } from "./types";

export async function readEntityText(surreal: Surreal, record: GraphEntityRecord): Promise<string | undefined> {
  const table = record.table.name;

  if (table === "workspace") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"workspace", string>);
    return row?.name;
  }

  if (table === "project") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"project", string>);
    return row?.name;
  }

  if (table === "person") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"person", string>);
    return row?.name;
  }

  if (table === "identity") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"identity", string>);
    return row?.name;
  }

  if (table === "feature") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"feature", string>);
    return row?.name;
  }

  if (table === "task") {
    const row = await surreal.select<{ title: string }>(record as RecordId<"task", string>);
    return row?.title;
  }

  if (table === "decision") {
    const row = await surreal.select<{ summary: string }>(record as RecordId<"decision", string>);
    return row?.summary;
  }

  const row = await surreal.select<{ text: string }>(record as RecordId<"question", string>);
  return row?.text;
}
