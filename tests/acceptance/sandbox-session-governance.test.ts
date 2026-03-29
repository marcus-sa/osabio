/**
 * Acceptance Tests: Sandbox Session Governance (Proxy Token Wiring)
 *
 * Verifies that the orchestrator's session spawn path issues proxy tokens
 * linked to intents and sessions, and passes proxy auth env to the adapter.
 *
 * Scenarios:
 *   PW-1: proxy_token record has intent + session fields after spawn
 *   PW-2: session env includes ANTHROPIC_BASE_URL pointing to proxy
 *   PW-3: session env includes X-Osabio-Auth via ANTHROPIC_CUSTOM_HEADERS
 *
 * Driving port: POST /api/orchestrator/:ws/assign
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  type AcceptanceTestRuntime,
} from "./acceptance-test-kit";
import {
  createTestUser,
  createWorkspaceViaHttp,
  createTaskDirectly,
} from "./shared-fixtures";

// -- Suite Setup --

const getRuntime = setupAcceptanceSuite("sandbox_session_governance", {
  configOverrides: {
    sandboxAgentEnabled: true,
    sandboxAgentType: "claude",
    orchestratorMockAgent: true,
  },
});

async function assignTask(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  taskId: string,
): Promise<{ agentSessionId: string; streamUrl: string }> {
  const response = await fetch(
    `${baseUrl}/api/orchestrator/${workspaceId}/assign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ taskId }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to assign task: ${response.status} ${body}`);
  }
  return (await response.json()) as { agentSessionId: string; streamUrl: string };
}

// -- Scenarios --

describe("Proxy Token Wiring: Sandbox Session Governance", () => {
  // PW-1: proxy_token record has intent + session fields after spawn
  it("proxy_token record has intent and session fields after session spawn", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a developer with a workspace and task
    const user = await createTestUser(baseUrl, `pw1-${crypto.randomUUID()}`);
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal, { repoPath: process.cwd() });
    const task = await createTaskDirectly(surreal, workspace.workspaceId, {
      title: "Implement proxy token wiring",
      description: "Wire proxy token issuance into adapter spawn path",
    });

    // When the developer assigns the task to a sandbox agent
    const assignment = await assignTask(baseUrl, user, workspace.workspaceId, task.taskId);
    expect(assignment.agentSessionId).toBeTruthy();

    // Then the proxy_token record in SurrealDB has intent and session fields
    const [tokens] = await surreal.query<[Array<{
      intent?: RecordId;
      session?: RecordId;
      workspace: RecordId;
      revoked: boolean;
    }>]>(
      `SELECT intent, session, workspace, revoked, created_at FROM proxy_token WHERE workspace = $ws AND revoked = false ORDER BY created_at DESC LIMIT 1;`,
      { ws: new RecordId("workspace", workspace.workspaceId) },
    );

    expect(tokens.length).toBeGreaterThan(0);
    const token = tokens[0];
    // intent field must be a record reference (not undefined/NONE)
    expect(token.intent).toBeDefined();
    // session field must be a record reference (not undefined/NONE)
    expect(token.session).toBeDefined();
  }, 30_000);

  // PW-2: session env includes ANTHROPIC_BASE_URL pointing to proxy
  it("adapter receives ANTHROPIC_BASE_URL pointing to osabio proxy", async () => {
    const { baseUrl, surreal, sandboxAgentAdapter } = getRuntime();

    // Given a developer with a workspace and task
    const user = await createTestUser(baseUrl, `pw2-${crypto.randomUUID()}`);
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal, { repoPath: process.cwd() });
    const task = await createTaskDirectly(surreal, workspace.workspaceId, {
      title: "Verify proxy URL in env",
      description: "Check ANTHROPIC_BASE_URL is set correctly",
    });

    // When the developer assigns the task to a sandbox agent
    await assignTask(baseUrl, user, workspace.workspaceId, task.taskId);

    // Then the adapter received env with ANTHROPIC_BASE_URL pointing to the proxy
    const lastRequest = sandboxAgentAdapter?.lastCreateSessionRequest;
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.env).toBeDefined();
    expect(lastRequest!.env!.ANTHROPIC_BASE_URL).toContain("/proxy/llm/anthropic");
  }, 30_000);

  // PW-3: session env includes X-Osabio-Auth via ANTHROPIC_CUSTOM_HEADERS
  it("adapter receives ANTHROPIC_CUSTOM_HEADERS with X-Osabio-Auth header", async () => {
    const { baseUrl, surreal, sandboxAgentAdapter } = getRuntime();

    // Given a developer with a workspace and task
    const user = await createTestUser(baseUrl, `pw3-${crypto.randomUUID()}`);
    const workspace = await createWorkspaceViaHttp(baseUrl, user, surreal, { repoPath: process.cwd() });
    const task = await createTaskDirectly(surreal, workspace.workspaceId, {
      title: "Verify auth token in env",
      description: "Check X-Osabio-Auth is passed via ANTHROPIC_CUSTOM_HEADERS",
    });

    // When the developer assigns the task to a sandbox agent
    await assignTask(baseUrl, user, workspace.workspaceId, task.taskId);

    // Then the adapter received env with ANTHROPIC_CUSTOM_HEADERS containing X-Osabio-Auth
    const lastRequest = sandboxAgentAdapter?.lastCreateSessionRequest;
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.env).toBeDefined();
    const customHeaders = lastRequest!.env!.ANTHROPIC_CUSTOM_HEADERS;
    expect(customHeaders).toBeDefined();
    // Format: "X-Osabio-Auth: brp_<token>"
    expect(customHeaders).toMatch(/^X-Osabio-Auth: brp_/);
  }, 30_000);
});
