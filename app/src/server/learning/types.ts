import type { RecordId } from "surrealdb";
import type { EntityPriority } from "../../shared/contracts";

export type {
  LearningType,
  LearningStatus,
  LearningSource,
  LearningSummary,
} from "../../shared/contracts";

export type LearningRecord = RecordId<"learning", string>;
export type EvidenceTargetRecord = RecordId<"message" | "trace" | "observation" | "agent_session" | "behavior", string>;

export type CreateLearningInput = {
  text: string;
  learningType: "constraint" | "instruction" | "precedent";
  priority?: EntityPriority;
  targetAgents?: string[];
  source: "human" | "agent";
  suggestedBy?: string;
  patternConfidence?: number;
  createdBy?: string;
  evidenceIds?: Array<{ table: "message" | "trace" | "observation" | "agent_session" | "behavior"; id: string }>;
  /** Override default status (e.g. force pending_approval when collision blocks activation) */
  forceStatus?: "active" | "pending_approval";
};
