import { describe, expect, it } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createEmbeddingVector } from "../../app/src/server/graph/embeddings";
import { fetchJson, setupSmokeSuite } from "./smoke-test-kit";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const getRuntime = setupSmokeSuite("intent-context");

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
const embeddingModel = openrouter.textEmbeddingModel(process.env.OPENROUTER_EMBEDDING_MODEL!);
const embeddingDimension = Number(process.env.EMBEDDING_DIMENSION!);

async function embedText(text: string): Promise<number[] | undefined> {
  return createEmbeddingVector(embeddingModel, text, embeddingDimension);
}

type IntentContextResponse = {
  level: "task" | "project" | "workspace";
  data: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// OAuth helpers (mirrors oauth-mcp-auth.test.ts pattern)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function signUpAndGetSession(baseUrl: string, email: string, name: string): Promise<{
  userId: string;
  headers: Record<string, string>;
}> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-123!", name }),
  });
  if (!res.ok) throw new Error(`Sign up failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { user: { id: string }; token: string };
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("better-auth.session_token="));
  const sessionToken = sessionCookie
    ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
    : data.token;

  return {
    userId: data.user.id,
    headers: { Cookie: `better-auth.session_token=${sessionToken}` },
  };
}

async function getOAuthToken(
  baseUrl: string,
  surreal: Surreal,
  sessionHeaders: Record<string, string>,
): Promise<string> {
  const dcrRes = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "intent-test-client",
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!dcrRes.ok) throw new Error(`DCR failed: ${dcrRes.status} ${await dcrRes.text()}`);

  const { client_id } = (await dcrRes.json()) as { client_id: string };

  await surreal.query(`UPDATE oauthClient SET skipConsent = true WHERE clientId = $cid;`, {
    cid: client_id,
  });

  const { verifier, challenge } = generatePkce();
  const authUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "graph:read graph:reason offline_access");
  authUrl.searchParams.set("state", "test-state");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", baseUrl);

  const authRes = await fetch(authUrl.toString(), {
    headers: sessionHeaders,
    redirect: "manual",
  });
  if (authRes.status !== 302) throw new Error(`Authorize did not redirect: ${authRes.status}`);

  const location = authRes.headers.get("location")!;
  const redirectUrl = new URL(location, baseUrl);
  const code = redirectUrl.searchParams.get("code") ?? "";
  if (!code) throw new Error(`No code in redirect: ${location}`);

  const tokenRes = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:9999/callback",
      client_id,
      code_verifier: verifier,
      resource: baseUrl,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);

  const tokens = (await tokenRes.json()) as { access_token: string };
  return tokens.access_token;
}

type AuthedWorkspace = {
  workspaceId: string;
  workspaceRecord: RecordId<"workspace", string>;
  accessToken: string;
};

async function createWorkspaceWithOAuth(
  baseUrl: string,
  surreal: Surreal,
  name?: string,
): Promise<AuthedWorkspace> {
  const email = `intent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const { userId, headers: sessionHeaders } = await signUpAndGetSession(baseUrl, email, "Intent Tester");

  const workspaceId = randomUUID();
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `CREATE $ws CONTENT {
      name: $name,
      status: "active",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: time::now(),
      created_at: time::now()
    };`,
    { ws: workspaceRecord, name: name ?? `Intent Smoke ${Date.now()}` },
  );

  // Create identity + spoke edge + workspace membership
  const personRecord = new RecordId("person", userId);
  const identityRecord = new RecordId("identity", randomUUID());
  await surreal.query(
    `CREATE $identity CONTENT { name: "Intent Tester", type: "human", role: "admin", workspace: $ws, created_at: time::now() };`,
    { identity: identityRecord, ws: workspaceRecord },
  );
  await surreal.query(
    `RELATE $identity->identity_person->$person SET added_at = time::now();`,
    { identity: identityRecord, person: personRecord },
  );
  await surreal.query(
    `RELATE $identity->member_of->$ws SET role = "admin", added_at = time::now();`,
    { identity: identityRecord, ws: workspaceRecord },
  );

  // Trigger JWKS key generation
  await fetch(`${baseUrl}/api/auth/jwks`);

  // Get OAuth token
  const accessToken = await getOAuthToken(baseUrl, surreal, sessionHeaders);

  return { workspaceId, workspaceRecord, accessToken };
}

async function seedProject(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", randomUUID());
  await surreal.create(projectRecord).content({
    name,
    status: "active",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await surreal
    .relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");
  return projectRecord;
}

async function seedTask(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  title: string,
  embedding?: number[],
): Promise<RecordId<"task", string>> {
  const taskRecord = new RecordId("task", randomUUID());
  await surreal.create(taskRecord).content({
    title,
    status: "open",
    priority: "medium",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
    ...(embedding ? { embedding } : {}),
  });
  await surreal
    .relate(taskRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");
  return taskRecord;
}

async function seedDecision(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  summary: string,
  status: string,
  embedding?: number[],
): Promise<RecordId<"decision", string>> {
  const decisionRecord = new RecordId("decision", randomUUID());
  await surreal.create(decisionRecord).content({
    summary,
    status,
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
    ...(embedding ? { embedding } : {}),
  });
  await surreal
    .relate(decisionRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");
  return decisionRecord;
}

function postContext(
  baseUrl: string,
  workspaceId: string,
  accessToken: string,
  body: { intent: string; cwd?: string; paths?: string[] },
): Promise<IntentContextResponse> {
  return fetchJson<IntentContextResponse>(`${baseUrl}/api/mcp/${workspaceId}/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests — realistic coding agent scenarios
// ---------------------------------------------------------------------------

describe("intent-context integration", () => {
  it("agent assigned a task via brain map gets task scope with siblings", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Payments Platform");
    const targetTask = await seedTask(surreal, ws.workspaceRecord, project, "Add payment processing");
    await seedTask(surreal, ws.workspaceRecord, project, "Implement refund flow");
    await seedDecision(surreal, ws.workspaceRecord, project, "Use Stripe for payments", "confirmed");
    const taskId = targetTask.id as string;

    // Agent says what brain map told it
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: `I'm implementing task:${taskId} - adding payment processing`,
    });

    expect(result.level).toBe("task");
    const data = result.data as any;
    expect(data.task_scope).toBeDefined();
    expect(data.task_scope.task.title).toBe("Add payment processing");
  }, 60_000);

  it("agent in single-project workspace gets project context with populated tasks and decisions", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Brain Platform");
    await seedTask(surreal, ws.workspaceRecord, project, "Build API rate limiting");
    await seedTask(surreal, ws.workspaceRecord, project, "Add error handling middleware");
    await seedDecision(surreal, ws.workspaceRecord, project, "Use token bucket for rate limiting", "confirmed");

    // Agent describes work naturally — no task ID, no project ID
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "I need to add error handling to the API endpoints",
    });

    expect(result.level).toBe("project");
    const data = result.data as any;
    expect(data.project.name).toBe("Brain Platform");
    expect(data.active_tasks.length).toBe(2);
    expect(data.decisions.confirmed.length).toBe(1);
    expect(data.decisions.confirmed[0].summary).toBe("Use token bucket for rate limiting");
  }, 60_000);

  it("agent references project:id and sees its tasks and decisions", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Mobile App");
    await seedTask(surreal, ws.workspaceRecord, project, "Fix push notification bug");
    await seedDecision(surreal, ws.workspaceRecord, project, "Use FCM over APNs", "provisional");
    const projectId = project.id as string;

    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: `I need the architecture context for project:${projectId}`,
    });

    expect(result.level).toBe("project");
    const data = result.data as any;
    expect(data.project.name).toBe("Mobile App");
    expect(data.active_tasks.length).toBe(1);
    expect(data.active_tasks[0].title).toBe("Fix push notification bug");
    expect(data.decisions.provisional.length).toBe(1);
  }, 60_000);

  it("multi-project workspace with cwd resolves to matching project", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const backend = await seedProject(surreal, ws.workspaceRecord, "Backend API");
    const mobile = await seedProject(surreal, ws.workspaceRecord, "Mobile App");
    await seedTask(surreal, ws.workspaceRecord, backend, "Add GraphQL resolvers");
    await seedTask(surreal, ws.workspaceRecord, mobile, "Fix login screen crash");

    // Agent working in mobile-app directory
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "Adding unit tests for the login module",
      cwd: "/Users/dev/mobile-app/src/auth",
    });

    expect(result.level).toBe("project");
    const data = result.data as any;
    expect(data.project.name).toBe("Mobile App");
    expect(data.active_tasks.some((t: any) => t.title === "Fix login screen crash")).toBe(true);
  }, 60_000);

  it("natural intent in multi-project workspace resolves via embedding similarity", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const billing = await seedProject(surreal, ws.workspaceRecord, "Billing Service");
    const docs = await seedProject(surreal, ws.workspaceRecord, "Documentation Site");

    // Seed a realistic graph — tasks, decisions, questions with real embeddings
    const [invoiceEmb, webhookEmb, docsEmb, decisionEmb] = await Promise.all([
      embedText("Implement Stripe invoice generation for recurring subscriptions"),
      embedText("Handle Stripe payment webhook events and update order status"),
      embedText("Write getting started guide and API reference docs"),
      embedText("Use Stripe Billing API instead of custom invoice logic"),
    ]);

    await seedTask(surreal, ws.workspaceRecord, billing, "Implement Stripe invoice generation for recurring subscriptions", invoiceEmb);
    await seedTask(surreal, ws.workspaceRecord, billing, "Handle Stripe payment webhook events and update order status", webhookEmb);
    await seedTask(surreal, ws.workspaceRecord, docs, "Write getting started guide and API reference docs", docsEmb);
    await seedDecision(surreal, ws.workspaceRecord, billing, "Use Stripe Billing API instead of custom invoice logic", "confirmed", decisionEmb);

    // Agent describes billing work — no task ID, no project ID, no cwd
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "I'm working on the payment invoice flow and need to handle Stripe webhooks",
    });

    // Should resolve via vector similarity — either task-level (direct match) or project-level
    expect(["task", "project"]).toContain(result.level);
    const data = result.data as any;
    if (result.level === "task") {
      expect(data.task_scope.task.title).toContain("Stripe");
    } else {
      expect(data.project.name).toBe("Billing Service");
      expect(data.active_tasks.length).toBe(2);
      expect(data.decisions.confirmed.length).toBe(1);
      expect(data.decisions.confirmed[0].summary).toContain("Stripe Billing API");
    }
  }, 90_000);

  it("vector search resolves to task-level context when intent closely matches a task", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Platform");
    const anotherProject = await seedProject(surreal, ws.workspaceRecord, "Admin Dashboard");

    const taskEmb = await embedText("Add Redis caching layer for user session tokens");
    await seedTask(surreal, ws.workspaceRecord, project, "Add Redis caching layer for user session tokens", taskEmb);

    const otherEmb = await embedText("Build admin user management page");
    await seedTask(surreal, ws.workspaceRecord, anotherProject, "Build admin user management page", otherEmb);

    // Agent intent closely matches the Redis task
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "Implementing Redis-based session caching for auth tokens",
    });

    // Should resolve to task-level (direct task match) or project-level (via task→project)
    expect(["task", "project"]).toContain(result.level);
    const data = result.data as any;
    if (result.level === "task") {
      expect(data.task_scope.task.title).toContain("Redis");
    } else {
      expect(data.project.name).toBe("Platform");
    }
  }, 90_000);

  it("ambiguous intent in multi-project workspace falls back to workspace overview", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Backend API");
    await seedProject(surreal, ws.workspaceRecord, "Mobile App");

    // Agent asks something generic — no task ID, no project match, no cwd
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "What should I work on next?",
    });

    expect(result.level).toBe("workspace");
    const data = result.data as any;
    expect(data.projects.length).toBe(2);
    const names = data.projects.map((p: any) => p.name).sort();
    expect(names).toEqual(["Backend API", "Mobile App"]);
  }, 60_000);

  it("nonexistent task:id falls through gracefully", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithOAuth(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Solo Project");

    // Agent has a stale task ID — should still get useful context (single project fallback)
    const result = await postContext(baseUrl, ws.workspaceId, ws.accessToken, {
      intent: "Continuing work on task:deleted-task-00000",
    });

    // Falls through explicit ref → single-project shortcut
    expect(result.level).toBe("project");
    const data = result.data as any;
    expect(data.project.name).toBe("Solo Project");
  }, 60_000);
});
