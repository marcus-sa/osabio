import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createConfirmDecisionTool } from "../../app/src/server/tools/confirm-decision";

function makeSurrealMock(queryResponses: unknown[][] = []) {
  const responses = [...queryResponses];
  return {
    query: (..._args: unknown[]) => {
      const next = responses.shift() ?? [[]];
      // Support both direct await (returns result) and .collect() chain
      const promise = Promise.resolve(next) as any;
      promise.collect = async () => next;
      return promise;
    },
    select: async () => undefined,
  };
}

describe("confirm_decision tool guards", () => {
  it("rejects calls without chat_agent actor", async () => {
    // Authority query returns "auto" permission so requireAuthorizedContext passes,
    // then the tool's own actor guard rejects non-chat_agent callers.
    // Each entry is a full surreal multi-statement result: [[row, ...]]
    const surreal = makeSurrealMock([
      [[{ permission: "auto" }]],
    ]);

    const tool = createConfirmDecisionTool({
      surreal: surreal as any,
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
    // Authority bypassed via humanPresent. isEntityInWorkspace + select for decision lookup.
    const decisionRecord = new RecordId("decision", "d-1");
    const surreal = makeSurrealMock([
      // isEntityInWorkspace: decision table query returns a matching row (collect format)
      [[{ id: decisionRecord }]],
    ]);
    surreal.select = async () => ({ id: decisionRecord, summary: "Some decision", status: "confirmed" }) as any;

    const tool = createConfirmDecisionTool({
      surreal: surreal as any,
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
            humanPresent: true,
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
