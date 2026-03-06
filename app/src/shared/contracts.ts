export type EntityKind = "workspace" | "project" | "person" | "feature" | "task" | "decision" | "question" | "observation" | "suggestion" | "message";

export type SourceKind = "message" | "document_chunk" | "git_commit";

export const ENTITY_CATEGORIES = ["engineering", "research", "marketing", "operations", "design", "sales"] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export const ENTITY_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type EntityPriority = (typeof ENTITY_PRIORITIES)[number];

export type CreateWorkspaceRequest = {
  name: string;
  description?: string;
};

export type CreateWorkspaceResponse = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  onboardingComplete: boolean;
};

export type ChatMessageRequest = {
  clientMessageId: string;
  workspaceId: string;
  conversationId?: string;
  text: string;
  onboardingAction?: OnboardingAction;
  discussEntityId?: string;
};

export type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

export type OnboardingState = "active" | "summary_pending" | "complete";
export type OnboardingAction = "finalize_onboarding" | "continue_onboarding";
export type ObservationSeverity = "info" | "warning" | "conflict";
export type ObservationStatus = "open" | "acknowledged" | "resolved";

export const OBSERVATION_TYPES = ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly"] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type ObservationSummary = {
  id: string;
  text: string;
  severity: ObservationSeverity;
  status: ObservationStatus;
  category?: EntityCategory;
  observationType?: ObservationType;
  sourceAgent: string;
  createdAt: string;
};

export const SUGGESTION_CATEGORIES = ["optimization", "risk", "opportunity", "conflict", "missing", "pivot"] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export const SUGGESTION_STATUSES = ["pending", "accepted", "dismissed", "deferred", "converted"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export type SuggestionSummary = {
  id: string;
  text: string;
  category: SuggestionCategory;
  rationale: string;
  suggestedBy: string;
  confidence: number;
  status: SuggestionStatus;
  createdAt: string;
};

export type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceKind: SourceKind;
  sourceId: string;
  category?: EntityCategory;
  priority?: EntityPriority;
};

export type ExtractedRelationship = {
  id: string;
  kind: string;
  fromId: string;
  toId: string;
  confidence: number;
  sourceKind?: SourceKind;
  sourceId?: string;
  sourceMessageId?: string;
  fromText?: string;
  toText?: string;
};

export type OnboardingSeedItem = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceKind: SourceKind;
  sourceId: string;
  sourceLabel?: string;
  category?: EntityCategory;
};

export type WorkspaceBootstrapMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  suggestions?: string[];
  inherited?: boolean;
};

export type ConversationSidebarItem = {
  id: string;
  title: string;
  updatedAt: string;
  parentId?: string;
  branches?: ConversationSidebarItem[];
};

export type ProjectFeatureActivity = {
  featureId: string;
  featureName: string;
  latestActivityAt: string;
};

export type ProjectConversationGroup = {
  projectId: string;
  projectName: string;
  conversations: ConversationSidebarItem[];
  featureActivity: ProjectFeatureActivity[];
};

export type WorkspaceConversationSidebarResponse = {
  groups: ProjectConversationGroup[];
  unlinked: ConversationSidebarItem[];
};

export type DiscussEntitySummary = {
  id: string;
  kind: EntityKind;
  name: string;
  status?: string;
};

export type WorkspaceConversationResponse = {
  conversationId: string;
  messages: WorkspaceBootstrapMessage[];
  discussEntity?: DiscussEntitySummary;
};

export type WorkspaceBootstrapResponse = {
  workspaceId: string;
  workspaceName: string;
  workspaceDescription?: string;
  onboardingComplete: boolean;
  onboardingState: OnboardingState;
  conversationId: string;
  messages: WorkspaceBootstrapMessage[];
  seeds: OnboardingSeedItem[];
  sidebar: WorkspaceConversationSidebarResponse;
};

export type TokenEvent = {
  type: "token";
  messageId: string;
  token: string;
};

export type AssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  text: string;
  suggestions?: string[];
};

export type ExtractionEvent = {
  type: "extraction";
  messageId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
};

export type OnboardingSeedEvent = {
  type: "onboarding_seed";
  messageId: string;
  seeds: OnboardingSeedItem[];
};

export type OnboardingStateEvent = {
  type: "onboarding_state";
  messageId: string;
  onboardingState: OnboardingState;
};

export type ObservationEvent = {
  type: "observation";
  messageId: string;
  action: "created" | "acknowledged" | "resolved";
  observation: ObservationSummary;
};

export type DoneEvent = {
  type: "done";
  messageId: string;
};

export type ErrorEvent = {
  type: "error";
  messageId: string;
  error: string;
};

export type ReasoningEvent = {
  type: "reasoning";
  messageId: string;
  token: string;
};

export type StreamEvent =
  | TokenEvent
  | ReasoningEvent
  | AssistantMessageEvent
  | ExtractionEvent
  | OnboardingSeedEvent
  | OnboardingStateEvent
  | ObservationEvent
  | DoneEvent
  | ErrorEvent;

export type SearchEntityResponse = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceId: string;
  sourceKind: SourceKind;
};

// --- Graph view types ---

export type ReagraphNode = {
  id: string;
  label: string;
  fill: string;
  data: {
    kind: EntityKind;
    connectionCount: number;
    status?: string;
  };
};

export type ReagraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: {
    type: string;
    confidence: number;
  };
};

export type GraphResponse = {
  nodes: ReagraphNode[];
  edges: ReagraphEdge[];
};

export type EntityDetailResponse = {
  entity: {
    id: string;
    kind: EntityKind;
    name: string;
    data: Record<string, unknown>;
  };
  relationships: Array<{
    id: string;
    kind: EntityKind;
    name: string;
    relationKind: string;
    direction: "incoming" | "outgoing";
    confidence: number;
  }>;
  provenance: Array<{
    sourceId: string;
    sourceKind: SourceKind;
    confidence: number;
    extractedAt: string;
    conversationId?: string;
    evidence?: string;
    evidenceSource?: string;
    resolvedFrom?: string;
    fromText?: string;
  }>;
};

export type BranchConversationRequest = {
  messageId: string;
};

export type BranchConversationResponse = {
  conversationId: string;
  parentConversationId: string;
  branchPointMessageId: string;
};

export type GovernanceTier = "blocking" | "review" | "awareness";

export type GovernanceFeedAction = {
  action: "confirm" | "override" | "acknowledge" | "resolve" | "complete" | "discuss" | "dismiss" | "accept" | "defer";
  label: string;
};

export type GovernanceFeedItem = {
  id: string;               // composite: "decision:<uuid>:provisional"
  tier: GovernanceTier;
  entityId: string;          // "decision:<uuid>"
  entityKind: EntityKind;
  entityName: string;
  reason: string;            // "Provisional decision awaiting confirmation"
  status: string;
  project?: string;
  category?: EntityCategory;
  priority?: EntityPriority;
  severity?: ObservationSeverity;
  createdAt: string;
  actions: GovernanceFeedAction[];
  conflictTarget?: {         // for conflict items
    entityId: string;
    entityKind: EntityKind;
    entityName: string;
  };
};

export type GovernanceFeedResponse = {
  blocking: GovernanceFeedItem[];
  review: GovernanceFeedItem[];
  awareness: GovernanceFeedItem[];
  updatedAt: string;
};

export type EntityActionRequest = {
  action: "confirm" | "override" | "complete" | "set_priority" | "acknowledge" | "resolve" | "dismiss" | "accept" | "defer" | "convert";
  notes?: string;
  newSummary?: string;
  priority?: EntityPriority;
  convertTo?: "task" | "feature" | "decision" | "project";
  convertTitle?: string;
};
