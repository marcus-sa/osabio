import { describe, expect, it } from "bun:test";
import { parseIncomingMessageRequest } from "../../app/src/server/http/parsing";

describe("onboardingAction parsing", () => {
  it("accepts valid JSON onboardingAction", async () => {
    const request = new Request("http://localhost/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: "c1",
        workspaceId: "w1",
        text: "Looks good",
        onboardingAction: "finalize_onboarding",
      }),
    });

    const parsed = await parseIncomingMessageRequest(request);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.onboardingAction).toBe("finalize_onboarding");
    }
  });

  it("rejects invalid JSON onboardingAction", async () => {
    const request = new Request("http://localhost/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: "c1",
        workspaceId: "w1",
        text: "Looks good",
        onboardingAction: "finalize",
      }),
    });

    const parsed = await parseIncomingMessageRequest(request);
    expect(parsed.ok).toBe(false);
  });

  it("accepts valid multipart onboardingAction", async () => {
    const form = new FormData();
    form.set("clientMessageId", "c1");
    form.set("workspaceId", "w1");
    form.set("text", "Need more edits");
    form.set("onboardingAction", "continue_onboarding");

    const request = new Request("http://localhost/api/chat/messages", {
      method: "POST",
      body: form,
    });

    const parsed = await parseIncomingMessageRequest(request);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.onboardingAction).toBe("continue_onboarding");
    }
  });
});
