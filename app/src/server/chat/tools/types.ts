import { RecordId, Surreal } from "surrealdb";

export type AgentType = "code_agent" | "architect" | "management" | "design_partner" | "observer";

export type ChatToolExecutionContext = {
  actor: "chat_agent" | "mcp" | "pm_agent" | "analytics_agent";
  agentType?: AgentType;
  /** True only for interactive web sessions where a human is actively present. Derived from identity.type === 'human'. */
  humanPresent?: boolean;
  identityRecord: RecordId<"identity", string>;
  workspaceRecord: RecordId<"workspace", string>;
  conversationRecord: RecordId<"conversation", string>;
  currentMessageRecord: RecordId<"message", string>;
  latestUserText: string;
  workspaceOwnerRecord?: RecordId<"identity", string>;
};

export type ChatToolDeps = {
  surreal: Surreal;
  embeddingModel: any;
  embeddingDimension: number;
  extractionModelId: string;
  extractionModel: any;
  extractionStoreThreshold: number;
};

export type ChatAgentToolDeps = ChatToolDeps & {
  pmAgentModel: any;
  analyticsAgentModel: any;
  analyticsSurreal: Surreal;
};
