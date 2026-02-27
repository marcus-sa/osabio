import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createConfirmDecisionTool } from "../../app/src/server/chat/tools/confirm-decision";

function makeQueryMock(responses: unknown[]) {
  return () => ({
    collect: async () => {
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("no mock response configured for query.collect");
      }
      return next;
    },
  });
}

describe("confirm_decision tool guards", () => {
  it("rejects calls without chat_agent actor", async () => {
    const tool = createConfirmDecisionTool({
      surreal: {} as any,
      embeddingModel: {} as any,
      embeddingDimension: 1536,
      extractionModelId: "test-model",
    });

    await expect(
      tool.execute!(
        { decision_id: "decision:d-1" },
        {
          toolCallId: "call-1",
          messages: [],
          experimental_context: {
            actor: "mcp",
            workspaceRecord: new RecordId("workspace", "w-1"),
            conversationRecord: new RecordId("conversation", "c-1"),
            currentMessageRecord: new RecordId("message", "m-1"),
            latestUserText: "yes, confirm",
          },
        } as any,
      ),
    ).rejects.toThrow("only available for chat_agent");
  });

  it("rejects non-confirmable decision statuses", async () => {
    const query = makeQueryMock([
      [[{ id: new RecordId("decision", "d-1") }]],
    ]);

    const surrealMock = {
      query,
      select: async () => ({ id: new RecordId("decision", "d-1"), summary: "Some decision", status: "confirmed" }),
    };

    const tool = createConfirmDecisionTool({
      surreal: surrealMock as any,
      embeddingModel: {} as any,
      embeddingDimension: 1536,
      extractionModelId: "test-model",
    });

    await expect(
      tool.execute!(
        { decision_id: "decision:d-1" },
        {
          toolCallId: "call-2",
          messages: [],
          experimental_context: {
            actor: "chat_agent",
            workspaceRecord: new RecordId("workspace", "w-1"),
            conversationRecord: new RecordId("conversation", "c-1"),
            currentMessageRecord: new RecordId("message", "m-1"),
            latestUserText: "what are the tradeoffs again?",
          },
        } as any,
      ),
    ).rejects.toThrow("not confirmable");
  });
});
