export type EntityKind = "workspace" | "project" | "person" | "feature" | "task" | "decision" | "question" | "observation";

export type SourceKind = "message" | "document_chunk";

export const ENTITY_CATEGORIES = ["engineering", "research", "marketing", "operations", "design", "sales"] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export type CreateWorkspaceRequest = {
  name: string;
  ownerDisplayName: string;
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

export type ObservationSummary = {
  id: string;
  text: string;
  severity: ObservationSeverity;
  status: ObservationStatus;
  category?: EntityCategory;
  sourceAgent: string;
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

export type WorkspaceConversationResponse = {
  conversationId: string;
  messages: WorkspaceBootstrapMessage[];
};

export type WorkspaceBootstrapResponse = {
  workspaceId: string;
  workspaceName: string;
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

export type StreamEvent =
  | TokenEvent
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
    sourceKind: "message" | "document_chunk";
    confidence: number;
    extractedAt: string;
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

export type EntityActionRequest = {
  action: "confirm" | "override" | "complete";
  notes?: string;
  newSummary?: string;
};
