import { RecordId } from "surrealdb";
import type {
  EntityKind,
  ExtractedEntity,
  ExtractedRelationship,
  OnboardingSeedItem,
} from "../../shared/contracts";

export type ExtractableEntityKind = Exclude<EntityKind, "workspace" | "observation">;
export type PersistableExtractableEntityKind = Exclude<ExtractableEntityKind, "person">;
export type GraphEntityTable = "workspace" | "project" | "person" | "feature" | "task" | "decision" | "question" | "observation";
export type GraphEntityRecord = RecordId<GraphEntityTable, string>;
export type SourceRecord = RecordId<"message" | "document_chunk" | "git_commit", string>;

export type MessageContextRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
};

export type ExtractionConversationContext = {
  conversationHistory: MessageContextRow[];
  currentMessage: MessageContextRow;
};

export type ExtractionGraphContextRow = {
  id: GraphEntityRecord;
  kind: ExtractableEntityKind;
  text: string;
  confidence: number;
  sourceMessage: RecordId<"message", string>;
};

export type CandidateEntityRow = {
  id: GraphEntityRecord;
  text: string;
  embedding?: number[];
};

export type ConversationProvenanceRow = {
  in: RecordId<"message", string>;
  out: GraphEntityRecord;
  confidence: number;
  extracted_at: Date | string;
};

export type PersistExtractionResult = {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  seeds: OnboardingSeedItem[];
  embeddingTargets: Array<{ record: GraphEntityRecord; text: string }>;
  tools: string[];
  unresolvedAssigneeNames: string[];
};

export type TempEntityReference = {
  record: GraphEntityRecord;
  text: string;
  id: string;
  kind: EntityKind;
};

export type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
  status: string;
  onboarding_complete: boolean;
  onboarding_turn_count: number;
  onboarding_summary_pending: boolean;
};

export type ConversationRow = {
  id: RecordId<"conversation", string>;
  createdAt: Date | string;
  updatedAt: Date | string;
  workspace: RecordId<"workspace", string>;
  source?: string;
  title?: string;
  title_source?: "message" | "entity";
  discusses?: RecordId;
};

export type IncomingAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
};

export type ProjectScopeRow = {
  id: RecordId<"project", string>;
  name: string;
};
