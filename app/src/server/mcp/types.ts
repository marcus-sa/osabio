import type { RecordId } from "surrealdb";
import type { AgentType } from "../chat/tools/types";

/** Validated MCP request context after workspace auth */
export type McpRequestContext = {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
};

/** Result of authenticating an MCP request via OAuth JWT */
export type McpAuthResult = {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  agentType: AgentType;
  personRecord: RecordId<"person", string>;
  scopes: Set<string>;
  /** Always false for MCP contexts — autonomous agents never bypass authority checks. */
  humanPresent: false;
};

/** Context packet returned by get_project_context */
export type ContextPacket = {
  workspace: { id: string; name: string };
  project: { id: string; name: string; status: string; description?: string };
  task_scope?: TaskScopeContext;
  decisions: {
    confirmed: DecisionContext[];
    provisional: DecisionContext[];
    contested: DecisionContext[];
  };
  active_tasks: TaskContext[];
  open_questions: QuestionContext[];
  recent_changes: RecentChangeContext[];
  observations: ObservationContext[];
  pending_suggestions: SuggestionContext[];
  active_sessions: ActiveSessionContext[];
};

export type TaskScopeContext = {
  task: { id: string; title: string; description?: string; status: string; category?: string };
  subtasks: { id: string; title: string; status: string }[];
  parent_feature?: { id: string; name: string; description?: string };
  sibling_tasks: { id: string; title: string; status: string; source_session?: string }[];
  dependencies: { id: string; title: string; status: string }[];
  related_sessions: { id: string; agent: string; ended_at: string; summary: string }[];
};

export type DecisionContext = {
  id: string;
  summary: string;
  status: string;
  rationale?: string;
  decided_at?: string;
  category?: string;
  priority?: string;
};

export type TaskContext = {
  id: string;
  title: string;
  status: string;
  priority?: string;
  category?: string;
  source_session?: string;
};

export type QuestionContext = {
  id: string;
  text: string;
  status: string;
  context?: string;
  priority?: string;
};

export type RecentChangeContext = {
  entity_type: string;
  entity_name: string;
  change_type: string;
  changed_at: string;
};

export type ObservationContext = {
  id: string;
  text: string;
  severity: string;
  status: string;
  category?: string;
  observation_type?: string;
};

export type SuggestionContext = {
  id: string;
  text: string;
  category: string;
  rationale: string;
  confidence: number;
  status: string;
  suggested_by: string;
  created_at: string;
};

export type ActiveSessionContext = {
  id: string;
  agent: string;
  started_at: string;
  task?: { id: string; title: string };
  provisional_decisions: Array<{ id: string; summary: string }>;
  observations: Array<{ id: string; text: string; severity: string }>;
};

/** Lightweight orientation packet — no params needed */
export type WorkspaceOverview = {
  workspace: { id: string; name: string };
  projects: Array<{
    id: string;
    name: string;
    status: string;
    description?: string;
    counts: { tasks: number; decisions: number; features: number; questions: number };
  }>;
  hot_items: HotItems;
  active_sessions: ActiveSessionContext[];
};

/** Task-focused context — task_id required, project resolved from graph */
export type TaskContextPacket = {
  workspace: { id: string; name: string };
  project: { id: string; name: string; status: string };
  task_scope: TaskScopeContext;
  hot_items: HotItems;
  active_sessions: ActiveSessionContext[];
};

export type HotItems = {
  contested_decisions: Array<{ id: string; summary: string }>;
  open_observations: Array<{ id: string; text: string; severity: string; category?: string }>;
  pending_suggestions: Array<{ id: string; text: string; category: string; confidence: number }>;
};
