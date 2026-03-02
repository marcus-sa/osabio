import type { RecordId } from "surrealdb";

export type DescriptionEntry = {
  text: string;
  source?: RecordId;
  created_at: Date;
};

export type DescriptionTarget = "project" | "feature" | "task";

export type DescriptionTriggerKind =
  | "decision_confirmed"
  | "feature_created"
  | "feature_completed"
  | "task_completed"
  | "task_created"
  | "scope_changed";

export type DescriptionTrigger = {
  kind: DescriptionTriggerKind;
  entity: RecordId;
  summary: string;
};
