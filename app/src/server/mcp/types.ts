import type { RecordId } from "surrealdb";

/** Validated MCP request context after workspace auth */
export type McpRequestContext = {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
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

export type ActiveSessionContext = {
  id: string;
  agent: string;
  started_at: string;
  task?: { id: string; title: string };
  provisional_decisions: Array<{ id: string; summary: string }>;
  observations: Array<{ id: string; text: string; severity: string }>;
};
