import { RecordId, type Surreal } from "surrealdb";
import type { PersistableExtractableEntityKind } from "./types";

export type PersonAttributionPatch =
  | { kind: "feature"; field: "owner"; value: string }
  | { kind: "feature"; field: "owner_name"; value: string }
  | { kind: "task"; field: "owner"; value: string }
  | { kind: "task"; field: "owner_name"; value: string }
  | { kind: "decision"; field: "decided_by"; value: string }
  | { kind: "decision"; field: "decided_by_name"; value: string }
  | { kind: "question"; field: "assigned_to"; value: string }
  | { kind: "question"; field: "assigned_to_name"; value: string };

export async function findWorkspacePersonByName(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  personName: string;
}): Promise<RecordId<"person", string> | undefined> {
  const normalizedName = input.personName.trim();
  if (normalizedName.length === 0) {
    return undefined;
  }

  const [rows] = await input.surreal
    .query<[Array<{ id: RecordId<"person", string> }>]>(
      [
        "SELECT id",
        "FROM person",
        "WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace)",
        "AND string::lowercase(name) = string::lowercase($name)",
        "LIMIT 1;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        name: normalizedName,
      },
    )
    .collect<[Array<{ id: RecordId<"person", string> }>]>() ;

  return rows[0]?.id;
}

export function resolvePersonAttributionPatch(input: {
  targetKind: PersistableExtractableEntityKind;
  assigneeName: string;
  personRecordId?: string;
}): PersonAttributionPatch {
  if (input.targetKind === "feature") {
    if (input.personRecordId) {
      return { kind: "feature", field: "owner", value: input.personRecordId };
    }

    return { kind: "feature", field: "owner_name", value: input.assigneeName };
  }

  if (input.targetKind === "task") {
    if (input.personRecordId) {
      return { kind: "task", field: "owner", value: input.personRecordId };
    }

    return { kind: "task", field: "owner_name", value: input.assigneeName };
  }

  if (input.targetKind === "decision") {
    if (input.personRecordId) {
      return { kind: "decision", field: "decided_by", value: input.personRecordId };
    }

    return { kind: "decision", field: "decided_by_name", value: input.assigneeName };
  }

  if (input.personRecordId) {
    return { kind: "question", field: "assigned_to", value: input.personRecordId };
  }

  return { kind: "question", field: "assigned_to_name", value: input.assigneeName };
}
