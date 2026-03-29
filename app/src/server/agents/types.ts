/**
 * Agent Domain Types
 *
 * Types for the agent CRUD module. Defines the domain model for
 * custom agent creation, authority scope configuration, and
 * lifecycle management.
 */

// ---------------------------------------------------------------------------
// Runtime classification
// ---------------------------------------------------------------------------

/** How the agent executes: osabio-managed, sandboxed, or external. */
export type AgentRuntime = "osabio" | "sandbox" | "external";

// ---------------------------------------------------------------------------
// Authority actions and permissions
// ---------------------------------------------------------------------------

/** The 11 configurable authority actions an agent can be scoped to. */
export type AuthorityAction =
  | "create_decision"
  | "confirm_decision"
  | "create_task"
  | "complete_task"
  | "create_observation"
  | "acknowledge_observation"
  | "resolve_observation"
  | "create_question"
  | "create_suggestion"
  | "create_intent"
  | "submit_intent";

/** All 11 actions as a constant array for iteration and validation. */
export const AUTHORITY_ACTIONS: readonly AuthorityAction[] = [
  "create_decision",
  "confirm_decision",
  "create_task",
  "complete_task",
  "create_observation",
  "acknowledge_observation",
  "resolve_observation",
  "create_question",
  "create_suggestion",
  "create_intent",
  "submit_intent",
] as const;

/** Permission level for an authority scope. */
export type AuthorityPermission = "auto" | "propose" | "blocked";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Sandbox configuration for sandbox-runtime agents. */
export type SandboxConfig = {
  coding_agents?: string[];
  env_vars?: Array<{ key: string; value: string }>;
  image?: string;
  snapshot?: string;
};

/** Authority scope input for agent creation. */
export type AuthorityScopeInput = {
  action: AuthorityAction;
  permission: AuthorityPermission;
};

/** Input for creating a new agent. */
export type CreateAgentInput = {
  name: string;
  description?: string;
  runtime: "sandbox" | "external"; // "osabio" not allowed via API
  model?: string;
  sandbox_config?: SandboxConfig;
  authority_scopes?: AuthorityScopeInput[];
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Agent summary returned from the list endpoint. */
export type AgentListItem = {
  id: string;
  name: string;
  description?: string;
  runtime: AgentRuntime;
  model?: string;
  identity_id: string;
  created_at: string;
};

/** Session summary for agent detail view. */
export type SessionSummary = {
  id: string;
  started_at: string;
  ended_at?: string;
  orchestrator_status?: string;
  summary?: string;
};

/** Full agent detail returned from the detail endpoint. */
export type AgentDetail = {
  agent: AgentListItem & { sandbox_config?: SandboxConfig };
  identity: { id: string; name: string; type: string; role?: string };
  authority_scopes: Array<{ action: string; permission: string }>;
  sessions: SessionSummary[];
};

/** Result of a successful agent creation. */
export type CreateAgentResult = {
  agent: AgentListItem;
  proxy_token?: string;
};

/** Result of a successful agent deletion. */
export type DeleteAgentResult = {
  deleted: true;
  sessions_aborted: number;
};
