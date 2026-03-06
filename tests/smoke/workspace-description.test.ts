import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { collectSseEvents, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type CreateWorkspaceResponse = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  onboardingComplete: boolean;
};

type BootstrapResponse = {
  workspaceId: string;
  workspaceName: string;
  workspaceDescription?: string;
  conversationId: string;
  onboardingState: string;
  onboardingComplete: boolean;
  messages: Array<{ role: string; text: string; suggestions?: string[] }>;
  seeds: Array<{ id: string }>;
};

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "token"; messageId: string; token: string }
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "extraction"; messageId: string; entities: Array<{ id: string }>; relationships: Array<{ id: string }> }
  | { type: "onboarding_state"; messageId: string; onboardingState: string }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("workspace_description");

function testEmail(label: string): string {
  return `${label}-${Date.now()}@smoke.test`;
}

async function signUp(baseUrl: string, email: string, name: string): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "smoke-test-password-123!", name }),
  });
  if (!res.ok) throw new Error(`Sign up failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("better-auth.session_token="));
  const sessionToken = sessionCookie
    ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
    : data.token;
  return { Cookie: `better-auth.session_token=${sessionToken}` };
}

describe("workspace description in onboarding", () => {
  it("creates workspace with description and adapts starter message", async () => {
    const { baseUrl } = getRuntime();

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "DabDash",
        ownerDisplayName: "Marcus",
        ownerEmail: testEmail("desc"),
        description: "Cannabis delivery storefront platform",
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);
    expect(create.workspaceName).toBe("DabDash");
    expect(create.onboardingComplete).toBe(false);

    // Bootstrap should return the description and adapted starter message
    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    expect(bootstrap.workspaceId).toBe(create.workspaceId);
    expect(bootstrap.workspaceDescription).toBe("Cannabis delivery storefront platform");
    expect(bootstrap.onboardingState).toBe("active");
    expect(bootstrap.messages.length).toBeGreaterThan(0);

    // Starter message should reference organizing the workspace and ask about projects
    const starterMessage = bootstrap.messages[0]!;
    expect(starterMessage.role).toBe("assistant");
    expect(starterMessage.text).toContain("DabDash");
    expect(starterMessage.text).toContain("projects");
    // Should NOT ask "what are you building" since we already have description
    expect(starterMessage.text).not.toContain("what you're working on");

    // Suggestions should be adapted for description-provided flow
    expect(starterMessage.suggestions).toBeDefined();
    expect(starterMessage.suggestions!.some((s) => s.toLowerCase().includes("first project"))).toBe(true);
  }, 120_000);

  it("creates workspace without description and does not create a project entity", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Sign up first to get session cookies for chat endpoint
    const authEmail = testEmail("nodesc-auth");
    const authHeaders = await signUp(baseUrl, authEmail, "Tester");

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TestCorp",
        ownerDisplayName: "Tester",
        ownerEmail: testEmail("nodesc"),
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);
    expect(create.onboardingComplete).toBe(false);

    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    // No description should be returned
    expect(bootstrap.workspaceDescription).toBeUndefined();

    // Default starter message should ask about what they're working on
    const starterMessage = bootstrap.messages[0]!;
    expect(starterMessage.role).toBe("assistant");
    expect(starterMessage.text).toContain("what you're working on");

    // Suggestions should use default wording
    expect(starterMessage.suggestions).toBeDefined();
    expect(starterMessage.suggestions!.some((s) => s.toLowerCase().includes("primary project"))).toBe(true);

    // Send a message describing the business (not a specific project)
    const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "I'm building DabDash, a cannabis delivery platform",
      }),
    });

    await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 180_000);

    // The agent should ask for clarification, NOT create a project entity
    const workspaceRecord = new RecordId("workspace", create.workspaceId);
    const [projects] = await surreal
      .query<[Array<{ id: RecordId<"project", string>; name: string }>]>(
        "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: workspaceRecord },
      )
      .then((r) => r as unknown as [Array<{ id: RecordId<"project", string>; name: string }>]);

    expect(projects).toEqual([]);
  }, 300_000);

  it("workspace with description streams a chat response successfully", async () => {
    const { baseUrl } = getRuntime();

    // Sign up first to get session cookies for chat endpoint
    const authEmail = testEmail("flow-auth");
    const authHeaders = await signUp(baseUrl, authEmail, "Marcus");

    // Create workspace with description
    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "DabDash",
        ownerDisplayName: "Marcus",
        ownerEmail: testEmail("flow"),
        description: "Cannabis delivery storefront platform",
      }),
    });

    // Send first chat message describing a project
    const firstChat = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "Project: Storefront App. We need to build a customer-facing ordering system with real-time delivery tracking.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${firstChat.streamUrl}`, 180_000);
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);

    // Verify description persists across bootstrap
    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );
    expect(bootstrap.workspaceDescription).toBe("Cannabis delivery storefront platform");
  }, 300_000);

  it("trims whitespace-only description to undefined", async () => {
    const { baseUrl } = getRuntime();

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "EmptyDesc",
        ownerDisplayName: "Tester",
        ownerEmail: testEmail("empty"),
        description: "   ",
      }),
    });

    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    // Whitespace-only description should be treated as absent
    expect(bootstrap.workspaceDescription).toBeUndefined();
    expect(bootstrap.messages[0]!.text).toContain("what you're working on");
  }, 120_000);
});
