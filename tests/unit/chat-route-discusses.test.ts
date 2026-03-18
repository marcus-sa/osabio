import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { selectConversationDiscussesRecord } from "../../app/src/server/chat/chat-route";

describe("chat route discuss entity context", () => {
  it("uses incoming discuss entity on first turn of a new conversation", () => {
    const incomingDiscussesRecord = new RecordId("feature", "feat-123");

    const selected = selectConversationDiscussesRecord({
      incomingDiscussesRecord,
    });

    expect(selected?.table.name).toBe("feature");
    expect(selected?.id).toBe("feat-123");
  });

  it("prefers persisted conversation discuss entity on existing conversations", () => {
    const existingConversation = {
      discusses: new RecordId("task", "task-1"),
    };
    const incomingDiscussesRecord = new RecordId("feature", "feat-123");

    const selected = selectConversationDiscussesRecord({
      existingConversation,
      incomingDiscussesRecord,
    });

    expect(selected?.table.name).toBe("task");
    expect(selected?.id).toBe("task-1");
  });
});
