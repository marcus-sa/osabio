import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { collectSseEvents, createTestUser, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

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

const getRuntime = setupSmokeSuite("onboarding");

describe("onboarding smoke", () => {
  it("bootstraps onboarding and completes full onboarding flow", async () => {
    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "onboarding");

    const create = await fetchJson<{
      workspaceId: string;
      workspaceName: string;
      conversationId: string;
      onboardingComplete: boolean;
    }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: `Smoke Workspace ${Date.now()}`,
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);
    expect(create.onboardingComplete).toBe(false);

    const bootstrap = await fetchJson<{
      workspaceId: string;
      conversationId: string;
      onboardingState: string;
      messages: Array<{ role: string; text: string }>;
      seeds: Array<{ id: string }>;
    }>(`${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`);

    expect(bootstrap.workspaceId).toBe(create.workspaceId);
    expect(bootstrap.conversationId).toBe(create.conversationId);
    expect(bootstrap.messages.length).toBeGreaterThan(0);

    const firstChat = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "Project: Brain Platform. Decision: use TypeScript first. Question: how to handle SurrealDB scaling risk?",
      }),
    });

    const firstEvents = await collectSseEvents<StreamEvent>(`${baseUrl}${firstChat.streamUrl}`, 180_000);
    // Chat agent handles onboarding — verify it responds to the user
    expect(firstEvents.some((event) => event.type === "assistant_message")).toBe(true);

    const uploadForm = new FormData();
    uploadForm.set("clientMessageId", randomUUID());
    uploadForm.set("workspaceId", create.workspaceId);
    uploadForm.set("conversationId", create.conversationId);
    uploadForm.set("text", "Uploading initial plan document");
    uploadForm.set(
      "file",
      new File(
        [[
          "# Product Plan\n",
          "## Current Project\n",
          "We are building Brain Platform onboarding.\n",
          "## Decision\n",
          "Choose SurrealDB with strict schemafull discipline.\n",
          "## Bottleneck\n",
          "Unclear integration sequencing across tools.\n",
        ].join("")],
        "plan.md",
        { type: "text/markdown" },
      ),
    );

    const uploadResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { ...user.headers },
      body: uploadForm,
    });

    const uploadEvents = await collectSseEvents<StreamEvent>(`${baseUrl}${uploadResponse.streamUrl}`, 180_000);
    // Attachment ingestion still runs automatically — extraction event should contain document entities
    expect(uploadEvents.some((event) => event.type === "extraction")).toBe(true);

    const confirm = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "Looks good, let's go.",
        onboardingAction: "finalize_onboarding",
      }),
    });

    await collectSseEvents<StreamEvent>(`${baseUrl}${confirm.streamUrl}`, 180_000);

    const finalBootstrap = await fetchJson<{
      onboardingComplete: boolean;
      onboardingState: string;
      seeds: Array<{ sourceKind: string; sourceId: string }>;
    }>(`${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`);

    // Seeds are populated from extraction_relation edges — created by attachment ingestion and agent tools
    expect(finalBootstrap.seeds.length).toBeGreaterThan(0);
    // Document upload should produce document_chunk sourced seeds
    expect(finalBootstrap.seeds.some((seed) => seed.sourceKind === "document_chunk")).toBe(true);
  }, 600_000);
});
