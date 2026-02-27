import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { collectSseEvents, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type SidebarResponse = {
  groups: Array<{
    projectId: string;
    projectName: string;
    conversations: Array<{ id: string; title: string; updatedAt: string }>;
    featureActivity: Array<{ featureId: string; featureName: string; latestActivityAt: string }>;
  }>;
  unlinked: Array<{ id: string; title: string; updatedAt: string }>;
};

type ConversationResponse = {
  conversationId: string;
  messages: Array<{
    id: string;
    role: string;
    text: string;
    createdAt: string;
  }>;
};

type BootstrapResponse = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  sidebar: SidebarResponse;
};

type StreamEvent =
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("conversation-sidebar");

async function sendMessageAndWait(
  baseUrl: string,
  workspaceId: string,
  conversationId: string | undefined,
  text: string,
): Promise<ChatMessageResponse> {
  const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      workspaceId,
      text,
      ...(conversationId ? { conversationId } : {}),
    }),
  });

  await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 60_000);
  return chatResponse;
}

describe("conversation sidebar smoke", () => {
  it("returns sidebar in bootstrap and via dedicated endpoint", async () => {
    const { baseUrl } = getRuntime();

    // Create workspace
    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Sidebar Smoke ${Date.now()}`,
          ownerDisplayName: "Marcus",
        }),
      },
    );

    // Send a message with extraction-worthy content
    await sendMessageAndWait(
      baseUrl,
      workspace.workspaceId,
      workspace.conversationId,
      "Task: implement the authentication module for the Brain platform. Decision: use JWT tokens for session management. Feature: user authentication with OAuth2 support.",
    );

    // Check sidebar endpoint
    const sidebar = await fetchJson<SidebarResponse>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/sidebar`,
    );

    // Should have conversations (either grouped or unlinked)
    const totalConversations =
      sidebar.groups.reduce((sum, group) => sum + group.conversations.length, 0) +
      sidebar.unlinked.length;

    expect(totalConversations).toBeGreaterThan(0);

    // Check bootstrap includes sidebar
    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/bootstrap`,
    );

    expect(bootstrap.sidebar).toBeDefined();
    expect(Array.isArray(bootstrap.sidebar.groups)).toBe(true);
    expect(Array.isArray(bootstrap.sidebar.unlinked)).toBe(true);
  }, 120_000);

  it("creates a new conversation when conversationId is omitted", async () => {
    const { baseUrl } = getRuntime();

    // Create workspace
    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `NewConv Smoke ${Date.now()}`,
          ownerDisplayName: "Marcus",
        }),
      },
    );

    // Send message WITHOUT conversationId — should create a new conversation
    const chatResponse = await sendMessageAndWait(
      baseUrl,
      workspace.workspaceId,
      undefined,
      "New conversation about the deployment pipeline",
    );

    expect(chatResponse.conversationId).toBeDefined();
    expect(chatResponse.conversationId.length).toBeGreaterThan(0);

    // Verify the new conversation is loadable
    const convResponse = await fetchJson<ConversationResponse>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/conversations/${chatResponse.conversationId}`,
    );

    expect(convResponse.conversationId).toBe(chatResponse.conversationId);
    expect(convResponse.messages.length).toBeGreaterThan(0);
  }, 120_000);

  it("conversation endpoint returns messages for existing conversation", async () => {
    const { baseUrl } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `ConvLoad Smoke ${Date.now()}`,
          ownerDisplayName: "Marcus",
        }),
      },
    );

    // Send a message to the onboarding conversation
    await sendMessageAndWait(
      baseUrl,
      workspace.workspaceId,
      workspace.conversationId,
      "Testing conversation loading",
    );

    // Load the conversation via dedicated endpoint
    const convResponse = await fetchJson<ConversationResponse>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/conversations/${workspace.conversationId}`,
    );

    expect(convResponse.conversationId).toBe(workspace.conversationId);
    // Should have at least starter message + user message + assistant response
    expect(convResponse.messages.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
