import type { BrainConfig } from "./config";

export class BrainHttpClient {
  private baseUrl: string;
  private workspaceId: string;
  private apiKey: string;

  constructor(config: BrainConfig) {
    this.baseUrl = config.server_url.replace(/\/$/, "");
    this.workspaceId = config.workspace;
    this.apiKey = config.api_key;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/mcp/${this.workspaceId}${path}`;
  }

  async getProjects(): Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }> {
    const res = await fetch(this.url("/projects"), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getContext(body: { intent: string; cwd?: string; paths?: string[] }): Promise<unknown> {
    const res = await fetch(this.url("/context"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to resolve context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getWorkspaceContext(body?: { session_id?: string }): Promise<unknown> {
    const res = await fetch(this.url("/workspace-context"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`Failed to get workspace context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getProjectContext(body: { project_id: string; task_id?: string; since?: string; session_id?: string }): Promise<unknown> {
    const res = await fetch(this.url("/project-context"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get project context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskContext(body: { task_id: string; session_id?: string }): Promise<unknown> {
    const res = await fetch(this.url("/task-context"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getDecisions(body: { project_id?: string; area?: string }): Promise<unknown> {
    const res = await fetch(this.url("/decisions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get decisions: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskDependencies(body: { task_id: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/dependencies"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task dependencies: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getConstraints(body: { project_id?: string; area?: string }): Promise<unknown> {
    const res = await fetch(this.url("/constraints"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getChanges(body: { project_id?: string; since: string }): Promise<unknown> {
    const res = await fetch(this.url("/changes"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get changes: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getEntityDetail(entityId: string): Promise<unknown> {
    const res = await fetch(this.url(`/entities/${entityId}`), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get entity: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async resolveDecision(body: { question: string; options?: string[]; context?: { project?: string; feature?: string } }): Promise<unknown> {
    const res = await fetch(this.url("/decisions/resolve"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to resolve decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async checkConstraints(body: { proposed_action: string; project?: string }): Promise<unknown> {
    const res = await fetch(this.url("/constraints/check"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to check constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createProvisionalDecision(body: { name: string; rationale: string; context?: { project?: string; feature?: string }; options_considered?: string[] }): Promise<unknown> {
    const res = await fetch(this.url("/decisions/provisional"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async askQuestion(body: { text: string; context?: { project?: string; feature?: string; task?: string }; options?: string[]; blocking_task?: string }): Promise<unknown> {
    const res = await fetch(this.url("/questions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to ask question: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async updateTaskStatus(body: { task_id: string; status: string; notes?: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/status"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update task: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createSubtask(body: { parent_task_id: string; title: string; category?: string; rationale?: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/subtask"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create subtask: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async logImplementationNote(body: { entity_id: string; note: string; files_changed?: string[] }): Promise<unknown> {
    const res = await fetch(this.url("/notes"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log note: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async logObservation(body: {
    text: string;
    category: string;
    severity: string;
    target?: string;
    session_id?: string;
  }): Promise<unknown> {
    const res = await fetch(this.url("/observations"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log observation: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async listSuggestions(body: { status?: string; category?: string; limit?: number }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to list suggestions: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createSuggestion(body: {
    text: string;
    category: string;
    rationale: string;
    confidence: number;
    target_entity_id?: string;
    evidence_entity_ids?: string[];
    session_id?: string;
  }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions/create"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async suggestionAction(body: { suggestion_id: string; action: string }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions/action"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to perform suggestion action: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async convertSuggestion(body: { suggestion_id: string; convert_to: string; title?: string }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions/convert"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to convert suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async sessionStart(body: { agent: string; project_id?: string; task_id?: string }): Promise<{ session_id: string }> {
    const res = await fetch(this.url("/sessions/start"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to start session: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ session_id: string }>;
  }

  async sessionEnd(body: {
    session_id: string;
    summary: string;
    decisions_made?: string[];
    questions_asked?: string[];
    tasks_progressed?: Array<{ task_id: string; from_status: string; to_status: string }>;
    files_changed?: Array<{ path: string; change_type: string }>;
    observations_logged?: string[];
    subtasks_created?: string[];
    suggestions_created?: string[];
  }): Promise<unknown> {
    const res = await fetch(this.url("/sessions/end"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to end session: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async checkCommit(body: {
    project_id?: string;
    diff: string;
    commit_message: string;
  }): Promise<{
    task_completions: Array<{ task_title: string; confidence: number }>;
    unlogged_decisions: Array<{ description: string }>;
    constraint_violations: Array<{ constraint: string; violation: string; severity: string }>;
    summary: string;
  }> {
    const res = await fetch(this.url("/commits/check"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to check commit: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async logCommit(body: {
    project_id: string;
    sha: string;
    message: string;
    author: string;
    task_updates?: Array<{ task_id: string; new_status: string }>;
    related_task_ids?: string[];
    decisions_detected?: Array<{ name: string; rationale: string }>;
  }): Promise<unknown> {
    const res = await fetch(this.url("/commits"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log commit: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** No-auth init endpoint */
  static async initApiKey(serverUrl: string, workspaceId: string): Promise<{ api_key: string; workspace: { id: string; name: string } }> {
    const url = `${serverUrl.replace(/\/$/, "")}/api/mcp/${workspaceId}/auth/init`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to init API key: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ api_key: string; workspace: { id: string; name: string } }>;
  }

  static async listProjects(serverUrl: string, workspaceId: string): Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }> {
    const url = `${serverUrl.replace(/\/$/, "")}/api/mcp/${workspaceId}/projects`;
    const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Failed to list projects: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }>;
  }
}
