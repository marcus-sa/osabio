import { type BrainConfig, findGitRoot, loadGlobalConfig, saveGlobalConfig } from "./config";
import { createDPoPProof, generateDPoPKeyMaterial } from "./dpop";

/**
 * Default authorization_details for CLI — covers all MCP operations.
 * Broad scope: the CLI acts as a privileged workspace client.
 */
const CLI_AUTHORIZATION_DETAILS = [
  { type: "brain_action", action: "read", resource: "workspace" },
  { type: "brain_action", action: "read", resource: "project" },
  { type: "brain_action", action: "read", resource: "task" },
  { type: "brain_action", action: "read", resource: "decision" },
  { type: "brain_action", action: "read", resource: "constraint" },
  { type: "brain_action", action: "read", resource: "change_log" },
  { type: "brain_action", action: "read", resource: "entity" },
  { type: "brain_action", action: "read", resource: "suggestion" },
  { type: "brain_action", action: "read", resource: "intent" },
  { type: "brain_action", action: "reason", resource: "decision" },
  { type: "brain_action", action: "reason", resource: "constraint" },
  { type: "brain_action", action: "reason", resource: "commit" },
  { type: "brain_action", action: "create", resource: "decision" },
  { type: "brain_action", action: "create", resource: "question" },
  { type: "brain_action", action: "create", resource: "task" },
  { type: "brain_action", action: "create", resource: "note" },
  { type: "brain_action", action: "create", resource: "observation" },
  { type: "brain_action", action: "create", resource: "suggestion" },
  { type: "brain_action", action: "create", resource: "session" },
  { type: "brain_action", action: "create", resource: "commit" },
  { type: "brain_action", action: "create", resource: "intent" },
  { type: "brain_action", action: "update", resource: "task" },
  { type: "brain_action", action: "update", resource: "session" },
  { type: "brain_action", action: "update", resource: "suggestion" },
  { type: "brain_action", action: "submit", resource: "intent" },
];

export class BrainHttpClient {
  private baseUrl: string;
  private workspaceId: string;
  private accessToken: string;
  private refreshToken: string;
  private tokenExpiresAt: number;
  private clientId: string;
  // DPoP fields
  private dpopPrivateJwk?: JsonWebKey;
  private dpopPublicJwk?: JsonWebKey;
  private dpopThumbprint?: string;
  private dpopAccessToken?: string;
  private dpopTokenExpiresAt?: number;
  private identityId?: string;

  constructor(config: BrainConfig) {
    this.baseUrl = config.server_url.replace(/\/$/, "");
    this.workspaceId = config.workspace;
    this.accessToken = config.access_token;
    this.refreshToken = config.refresh_token;
    this.tokenExpiresAt = config.token_expires_at;
    this.clientId = config.client_id;
    this.dpopPrivateJwk = config.dpop_private_jwk;
    this.dpopPublicJwk = config.dpop_public_jwk;
    this.dpopThumbprint = config.dpop_thumbprint;
    this.dpopAccessToken = config.dpop_access_token;
    this.dpopTokenExpiresAt = config.dpop_token_expires_at;
    this.identityId = config.identity_id;
  }

  // ---------------------------------------------------------------------------
  // DPoP key material bootstrap
  // ---------------------------------------------------------------------------

  private async ensureDPoPKeyMaterial(): Promise<void> {
    if (this.dpopPrivateJwk && this.dpopPublicJwk && this.dpopThumbprint) return;

    const material = await generateDPoPKeyMaterial();
    this.dpopPrivateJwk = material.privateJwk;
    this.dpopPublicJwk = material.publicJwk;
    this.dpopThumbprint = material.thumbprint;
    await this.persistDPoPState();
  }

  // ---------------------------------------------------------------------------
  // Identity discovery
  // ---------------------------------------------------------------------------

  private async ensureIdentity(): Promise<void> {
    if (this.identityId) return;

    const res = await fetch(`${this.baseUrl}/api/auth/identity/${this.workspaceId}`);
    if (!res.ok) {
      throw new Error(`Identity discovery failed: ${res.status}. Run 'brain init' to re-authenticate.`);
    }
    const data = await res.json() as { identity_id: string };
    this.identityId = data.identity_id;
    await this.persistDPoPState();
  }

  // ---------------------------------------------------------------------------
  // DPoP token acquisition via intent submission + token endpoint
  // ---------------------------------------------------------------------------

  private async ensureDPoPToken(): Promise<void> {
    // Refresh 30 seconds before expiry
    if (
      this.dpopAccessToken &&
      this.dpopTokenExpiresAt &&
      Date.now() < (this.dpopTokenExpiresAt - 30) * 1000
    ) {
      return;
    }

    await this.ensureDPoPKeyMaterial();
    await this.ensureIdentity();

    // Step 1: Submit intent with broad authorization_details
    const intentRes = await fetch(`${this.baseUrl}/api/auth/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: this.workspaceId,
        identity_id: this.identityId,
        authorization_details: CLI_AUTHORIZATION_DETAILS,
        dpop_jwk_thumbprint: this.dpopThumbprint,
        goal: "CLI workspace access",
        reasoning: "Brain CLI requires broad MCP access for workspace operations",
      }),
    });

    if (!intentRes.ok) {
      const text = await intentRes.text();
      throw new Error(`Intent submission failed: ${intentRes.status} ${text}. Run 'brain init' to re-authenticate.`);
    }

    const intentData = await intentRes.json() as {
      intent_id: string;
      status: string;
    };

    if (intentData.status !== "authorized") {
      throw new Error(
        `Intent not auto-approved (status: ${intentData.status}). ` +
        "CLI requires auto-approval for broad read/write access. Check identity permissions.",
      );
    }

    // Step 2: Exchange intent for DPoP-bound token
    const tokenUrl = `${this.baseUrl}/api/auth/token`;
    const dpopProof = await createDPoPProof(
      this.dpopPrivateJwk!,
      this.dpopPublicJwk!,
      "POST",
      tokenUrl,
    );

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        DPoP: dpopProof,
      },
      body: JSON.stringify({
        grant_type: "urn:brain:intent-authorization",
        intent_id: intentData.intent_id,
        authorization_details: CLI_AUTHORIZATION_DETAILS,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    this.dpopAccessToken = tokenData.access_token;
    this.dpopTokenExpiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
    await this.persistDPoPState();
  }

  // ---------------------------------------------------------------------------
  // Per-request DPoP headers
  // ---------------------------------------------------------------------------

  private async dpopHeaders(method: string, url: string): Promise<Record<string, string>> {
    await this.ensureDPoPToken();

    const proof = await createDPoPProof(
      this.dpopPrivateJwk!,
      this.dpopPublicJwk!,
      method,
      url,
    );

    return {
      "Content-Type": "application/json",
      Authorization: `DPoP ${this.dpopAccessToken}`,
      DPoP: proof,
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy Bearer headers (for non-MCP endpoints)
  // ---------------------------------------------------------------------------

  private async refreshBearerTokenIfNeeded(): Promise<void> {
    if (Date.now() < (this.tokenExpiresAt - 60) * 1000) return;
    const oauthResource = `${this.baseUrl}/api/auth`;

    const res = await fetch(`${this.baseUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        resource: oauthResource,
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

    const gitRoot = findGitRoot(process.cwd());
    const global = await loadGlobalConfig();
    if (global && gitRoot && global.repos[gitRoot]) {
      global.repos[gitRoot].access_token = this.accessToken;
      if (data.refresh_token) global.repos[gitRoot].refresh_token = this.refreshToken;
      global.repos[gitRoot].token_expires_at = this.tokenExpiresAt;
      await saveGlobalConfig(global);
    }
  }

  // ---------------------------------------------------------------------------
  // Config persistence
  // ---------------------------------------------------------------------------

  private async persistDPoPState(): Promise<void> {
    const gitRoot = findGitRoot(process.cwd());
    const global = await loadGlobalConfig();
    if (global && gitRoot && global.repos[gitRoot]) {
      const repo = global.repos[gitRoot];
      repo.dpop_private_jwk = this.dpopPrivateJwk;
      repo.dpop_public_jwk = this.dpopPublicJwk;
      repo.dpop_thumbprint = this.dpopThumbprint;
      repo.dpop_access_token = this.dpopAccessToken;
      repo.dpop_token_expires_at = this.dpopTokenExpiresAt;
      repo.identity_id = this.identityId;
      await saveGlobalConfig(global);
    }
  }

  // ---------------------------------------------------------------------------
  // URL builder
  // ---------------------------------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}/api/mcp/${this.workspaceId}${path}`;
  }

  // ---------------------------------------------------------------------------
  // MCP API methods — all use DPoP auth with fresh proof per request
  // ---------------------------------------------------------------------------

  async getProjects(): Promise<{ workspace: { id: string; name: string }; projects: Array<{ id: string; name: string }> }> {
    const fullUrl = this.url("/projects");
    const res = await fetch(fullUrl, { headers: await this.dpopHeaders("GET", fullUrl) });
    if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getContext(body: { intent: string; cwd?: string; paths?: string[] }): Promise<unknown> {
    const fullUrl = this.url("/context");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to resolve context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getWorkspaceContext(body?: { session_id?: string }): Promise<unknown> {
    const fullUrl = this.url("/workspace-context");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`Failed to get workspace context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getProjectContext(body: { project_id: string; task_id?: string; since?: string; session_id?: string }): Promise<unknown> {
    const fullUrl = this.url("/project-context");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get project context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskContext(body: { task_id: string; session_id?: string }): Promise<unknown> {
    const fullUrl = this.url("/task-context");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task context: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getDecisions(body: { project_id?: string; area?: string }): Promise<unknown> {
    const fullUrl = this.url("/decisions");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get decisions: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getTaskDependencies(body: { task_id: string }): Promise<unknown> {
    const fullUrl = this.url("/tasks/dependencies");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get task dependencies: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getConstraints(body: { project_id?: string; area?: string }): Promise<unknown> {
    const fullUrl = this.url("/constraints");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getChanges(body: { project_id?: string; since: string }): Promise<unknown> {
    const fullUrl = this.url("/changes");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to get changes: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getEntityDetail(entityId: string): Promise<unknown> {
    const fullUrl = this.url(`/entities/${entityId}`);
    const res = await fetch(fullUrl, { headers: await this.dpopHeaders("GET", fullUrl) });
    if (!res.ok) throw new Error(`Failed to get entity: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async resolveDecision(body: { question: string; options?: string[]; context?: { project?: string; feature?: string } }): Promise<unknown> {
    const fullUrl = this.url("/decisions/resolve");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to resolve decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async checkConstraints(body: { proposed_action: string; project?: string }): Promise<unknown> {
    const fullUrl = this.url("/constraints/check");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to check constraints: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createProvisionalDecision(body: { name: string; rationale: string; context?: { project?: string; feature?: string }; options_considered?: string[] }): Promise<unknown> {
    const fullUrl = this.url("/decisions/provisional");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create decision: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async askQuestion(body: { text: string; context?: { project?: string; feature?: string; task?: string }; options?: string[]; blocking_task?: string }): Promise<unknown> {
    const fullUrl = this.url("/questions");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to ask question: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async updateTaskStatus(body: { task_id: string; status: string; notes?: string }): Promise<unknown> {
    const fullUrl = this.url("/tasks/status");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update task: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async createSubtask(body: { parent_task_id: string; title: string; category?: string; rationale?: string }): Promise<unknown> {
    const fullUrl = this.url("/tasks/subtask");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create subtask: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async logImplementationNote(body: { entity_id: string; note: string; files_changed?: string[] }): Promise<unknown> {
    const fullUrl = this.url("/notes");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
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
    const fullUrl = this.url("/observations");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to log observation: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async listSuggestions(body: { status?: string; category?: string; limit?: number }): Promise<unknown> {
    const fullUrl = this.url("/suggestions");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
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
    const fullUrl = this.url("/suggestions/create");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async suggestionAction(body: { suggestion_id: string; action: string }): Promise<unknown> {
    const fullUrl = this.url("/suggestions/action");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to perform suggestion action: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async convertSuggestion(body: { suggestion_id: string; convert_to: string; title?: string }): Promise<unknown> {
    const fullUrl = this.url("/suggestions/convert");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to convert suggestion: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async sessionStart(body: { agent: string; project_id?: string; task_id?: string }): Promise<{ session_id: string }> {
    const fullUrl = this.url("/sessions/start");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
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
    const fullUrl = this.url("/sessions/end");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to end session: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async preCheckCommit(body: {
    project_id?: string;
    diff: string;
    commit_message: string;
  }): Promise<{
    task_completions: Array<{ task_title: string; confidence: number }>;
    unlogged_decisions: Array<{ description: string }>;
    constraint_violations: Array<{ constraint: string; violation: string; severity: string }>;
    summary: string;
  }> {
    const fullUrl = this.url("/commits/pre-check");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to pre-check commit: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async postCheckCommit(body: {
    commit_message: string;
  }): Promise<{
    updated_tasks: Array<{ task_id: string; status: string; updated: boolean }>;
  }> {
    const fullUrl = this.url("/commits/post-check");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to post-check commit: ${res.status} ${await res.text()}`);
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
    const fullUrl = this.url("/commits");
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: await this.dpopHeaders("POST", fullUrl),
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
