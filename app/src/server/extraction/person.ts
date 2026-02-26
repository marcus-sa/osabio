export const ownerRelationKinds = new Set(["OWNER", "OWNED_BY", "HAS_OWNER"]);
export const decisionByRelationKinds = new Set(["DECIDED_BY", "MADE_BY", "DECISION_BY"]);
export const assignedRelationKinds = new Set(["ASSIGNED_TO", "ASKED_TO", "RESPONSIBLE_FOR"]);

export type PersonReferencePatch =
  | { kind: "feature"; field: "owner"; value: string }
  | { kind: "feature"; field: "owner_name"; value: string }
  | { kind: "task"; field: "owner"; value: string }
  | { kind: "task"; field: "owner_name"; value: string }
  | { kind: "decision"; field: "decided_by"; value: string }
  | { kind: "decision"; field: "decided_by_name"; value: string }
  | { kind: "question"; field: "assigned_to"; value: string }
  | { kind: "question"; field: "assigned_to_name"; value: string };

export function resolvePersonReferencePatch(input: {
  targetKind: "feature" | "task" | "decision" | "question";
  relationshipKind: string;
  personName: string;
  personRecordId?: string;
}): PersonReferencePatch | undefined {
  if (input.targetKind === "feature" && ownerRelationKinds.has(input.relationshipKind)) {
    if (input.personRecordId) {
      return { kind: "feature", field: "owner", value: input.personRecordId };
    }

    return { kind: "feature", field: "owner_name", value: input.personName };
  }

  if (input.targetKind === "task" && (ownerRelationKinds.has(input.relationshipKind) || assignedRelationKinds.has(input.relationshipKind))) {
    if (input.personRecordId) {
      return { kind: "task", field: "owner", value: input.personRecordId };
    }

    return { kind: "task", field: "owner_name", value: input.personName };
  }

  if (input.targetKind === "decision" && decisionByRelationKinds.has(input.relationshipKind)) {
    if (input.personRecordId) {
      return { kind: "decision", field: "decided_by", value: input.personRecordId };
    }

    return { kind: "decision", field: "decided_by_name", value: input.personName };
  }

  if (input.targetKind !== "question" || !assignedRelationKinds.has(input.relationshipKind)) {
    return undefined;
  }

  if (input.personRecordId) {
    return { kind: "question", field: "assigned_to", value: input.personRecordId };
  }

  return { kind: "question", field: "assigned_to_name", value: input.personName };
}
