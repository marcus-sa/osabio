import { type BrainConfig, findGitRoot, loadGlobalConfig, saveGlobalConfig } from "./config";

export class BrainHttpClient {
  private baseUrl: string;
  private workspaceId: string;
  private accessToken: string;
  private refreshToken: string;
  private tokenExpiresAt: number;
  private clientId: string;

  constructor(config: BrainConfig) {
    this.baseUrl = config.server_url.replace(/\/$/, "");
    this.workspaceId = config.workspace;
    this.accessToken = config.access_token;
    this.refreshToken = config.refresh_token;
    this.tokenExpiresAt = config.token_expires_at;
    this.clientId = config.client_id;
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    // Refresh 60 seconds before expiry
    if (Date.now() < (this.tokenExpiresAt - 60) * 1000) return;

    const res = await fetch(`${this.baseUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        resource: this.baseUrl,
      }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}. Run 'brain init' to re-authenticate.`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

    // Persist updated tokens
    const gitRoot = findGitRoot(process.cwd());
    const global = await loadGlobalConfig();
    if (global && gitRoot && global.repos[gitRoot]) {
      global.repos[gitRoot].access_token = this.accessToken;
      if (data.refresh_token) global.repos[gitRoot].refresh_token = this.refreshToken;
      global.repos[gitRoot].token_expires_at = this.tokenExpiresAt;
      await saveGlobalConfig(global);
    }
  }

  private async headers(): Promise<Record<string, string>> {
    await this.refreshTokenIfNeeded();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/mcp/${this.workspaceId}${path}`;
  }

  async getProjects(): Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }> {
    const res = await fetch(this.url("/projects"), { headers: await this.headers() });
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
      headers: await this.headers(),
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`Failed to get workspace context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getProjectContext(body: { project_id: string; task_id?: string; since?: string; session_id?: string }): Promise<unknown> {
    const res = await fetch(this.url("/project-context"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get project context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskContext(body: { task_id: string; session_id?: string }): Promise<unknown> {
    const res = await fetch(this.url("/task-context"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getDecisions(body: { project_id?: string; area?: string }): Promise<unknown> {
    const res = await fetch(this.url("/decisions"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get decisions: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskDependencies(body: { task_id: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/dependencies"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task dependencies: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getConstraints(body: { project_id?: string; area?: string }): Promise<unknown> {
    const res = await fetch(this.url("/constraints"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getChanges(body: { project_id?: string; since: string }): Promise<unknown> {
    const res = await fetch(this.url("/changes"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get changes: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getEntityDetail(entityId: string): Promise<unknown> {
    const res = await fetch(this.url(`/entities/${entityId}`), { headers: await this.headers() });
    if (!res.ok) throw new Error(`Failed to get entity: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async resolveDecision(body: { question: string; options?: string[]; context?: { project?: string; feature?: string } }): Promise<unknown> {
    const res = await fetch(this.url("/decisions/resolve"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to resolve decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async checkConstraints(body: { proposed_action: string; project?: string }): Promise<unknown> {
    const res = await fetch(this.url("/constraints/check"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to check constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createProvisionalDecision(body: { name: string; rationale: string; context?: { project?: string; feature?: string }; options_considered?: string[] }): Promise<unknown> {
    const res = await fetch(this.url("/decisions/provisional"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async askQuestion(body: { text: string; context?: { project?: string; feature?: string; task?: string }; options?: string[]; blocking_task?: string }): Promise<unknown> {
    const res = await fetch(this.url("/questions"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to ask question: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async updateTaskStatus(body: { task_id: string; status: string; notes?: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/status"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update task: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createSubtask(body: { parent_task_id: string; title: string; category?: string; rationale?: string }): Promise<unknown> {
    const res = await fetch(this.url("/tasks/subtask"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create subtask: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async logImplementationNote(body: { entity_id: string; note: string; files_changed?: string[] }): Promise<unknown> {
    const res = await fetch(this.url("/notes"), {
      method: "POST",
      headers: await this.headers(),
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
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log observation: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async listSuggestions(body: { status?: string; category?: string; limit?: number }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions"), {
      method: "POST",
      headers: await this.headers(),
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
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async suggestionAction(body: { suggestion_id: string; action: string }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions/action"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to perform suggestion action: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async convertSuggestion(body: { suggestion_id: string; convert_to: string; title?: string }): Promise<unknown> {
    const res = await fetch(this.url("/suggestions/convert"), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to convert suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async sessionStart(body: { agent: string; project_id?: string; task_id?: string }): Promise<{ session_id: string }> {
    const res = await fetch(this.url("/sessions/start"), {
      method: "POST",
      headers: await this.headers(),
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
      headers: await this.headers(),
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
      headers: await this.headers(),
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
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log commit: ${res.status} ${await res.text()}`);
    return res.json();
  }

  static async listProjects(serverUrl: string, workspaceId: string): Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }> {
    const url = `${serverUrl.replace(/\/$/, "")}/api/mcp/${workspaceId}/projects`;
    const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Failed to list projects: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }>;
  }
}
