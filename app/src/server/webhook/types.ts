import type { RecordId, Surreal } from "surrealdb";
import type { EntityKind, ExtractedEntity, ExtractedRelationship } from "../../shared/contracts";

// --- GitHub Push Event (subset of fields we use) ---

export type GitHubPushCommit = {
  id: string;
  message: string;
  timestamp: string;
  url: string;
  author: {
    name: string;
    email: string;
    username?: string;
  };
};

export type GitHubPushEvent = {
  ref: string;
  repository: {
    full_name: string;
    default_branch: string;
    html_url: string;
  };
  commits: GitHubPushCommit[];
};

// --- Commit Processing ---

export type CommitInput = {
  sha: string;
  message: string;
  authoredAt: string;
  authorName: string;
  authorEmail: string;
  authorUsername?: string;
  url: string;
  repository: string;
};

export type ProcessCommitInput = {
  surreal: Surreal;
  extractionModel: unknown;
  embeddingModel: unknown;
  embeddingDimension: number;
  extractionStoreThreshold: number;
  extractionModelId: string;
  workspaceRecord: RecordId<"workspace", string>;
  commit: CommitInput;
  workspaceName?: string;
  projectNames?: string[];
  autoLinkThreshold: number;
  now: Date;
};

export type TaskStatusUpdateResult = {
  taskId: string;
  status: string;
};

export type ProcessCommitResult = {
  commitRecord: RecordId<"git_commit", string>;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  autoLinkedDecisions: string[];
  observationsCreated: string[];
  taskStatusUpdates: TaskStatusUpdateResult[];
};

// --- Webhook Processing ---

export type ProcessWebhookInput = {
  surreal: Surreal;
  extractionModel: unknown;
  embeddingModel: unknown;
  embeddingDimension: number;
  extractionStoreThreshold: number;
  extractionModelId: string;
  workspaceRecord: RecordId<"workspace", string>;
  event: GitHubPushEvent;
  autoLinkThreshold: number;
};

export type ProcessWebhookResult = {
  commitsProcessed: number;
  commitsSkipped: number;
  totalEntities: number;
  totalRelationships: number;
  autoLinkedDecisions: string[];
  observationsCreated: string[];
  taskStatusUpdates: TaskStatusUpdateResult[];
};

// --- Decision Linking Classification ---

export type DecisionLinkAction =
  | { action: "auto_link"; entityId: string; confidence: number }
  | { action: "observe"; entityId: string; text: string; confidence: number };

export function classifyDecisionLinks(
  entities: Array<{ id: string; kind: EntityKind; text: string; confidence: number }>,
  autoLinkThreshold: number,
): DecisionLinkAction[] {
  const actions: DecisionLinkAction[] = [];
  for (const entity of entities) {
    if (entity.kind !== "decision") continue;
    if (entity.confidence >= autoLinkThreshold) {
      actions.push({ action: "auto_link", entityId: entity.id, confidence: entity.confidence });
    } else {
      actions.push({ action: "observe", entityId: entity.id, text: entity.text, confidence: entity.confidence });
    }
  }
  return actions;
}
