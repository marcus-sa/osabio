import { RecordId, Surreal } from "surrealdb";

export type ChatToolExecutionContext = {
  actor: "chat_agent" | "mcp" | "pm_agent" | "analytics_agent";
  agentType?: string;
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
  extractionModelId: string;
  extractionModel: any;
  extractionStoreThreshold: number;
};

export type ChatAgentToolDeps = ChatToolDeps & {
  pmAgentModel: any;
  analyticsAgentModel: any;
  analyticsSurreal: Surreal;
};
