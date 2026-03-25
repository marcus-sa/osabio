import { tool } from "ai";
import { z } from "zod";
import {
  parseRecordIdString,
  readEntityName,
  type GraphEntityRecord,
} from "../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";
import { type RecordId, type Surreal } from "surrealdb";

type RankedMessage = {
  id: string;
  conversationId: string;
  text: string;
  score: number;
};

/** Core logic — shared by AI SDK tool wrapper and MCP handler. */
export async function executeGetConversationHistory(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  input: { query: string },
) {
  const trimmed = input.query.trim();
  if (trimmed.length === 0) return { query: input.query, results: [] };

  const [messageRows] = await surreal
    .query<[Array<{
      id: RecordId<"message", string>;
      conversation: RecordId<"conversation", string>;
      text: string;
      score: number;
    }>]>(
      `SELECT id, conversation, text, search::score(1) AS score
       FROM message
       WHERE text @1@ $query
       AND conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)
       ORDER BY score DESC
       LIMIT 8;`,
      { workspace: workspaceRecord, query: trimmed },
    )
    .collect<[Array<{
      id: RecordId<"message", string>;
      conversation: RecordId<"conversation", string>;
      text: string;
      score: number;
    }>]>();

  const messages: RankedMessage[] = (messageRows ?? []).map((row) => ({
    id: row.id.id as string,
    conversationId: row.conversation.id as string,
    text: row.text,
    score: row.score,
  }));

  const enrichedMessages = await Promise.all(
    messages.map(async (message) => {
      const messageRecord = parseRecordIdString(message.id, ["message"], "message");
      const [entityRows] = await surreal
        .query<[Array<GraphEntityRecord>]>(
          "SELECT VALUE out FROM extraction_relation WHERE `in` = $message LIMIT 8;",
          { message: messageRecord },
        )
        .collect<[Array<GraphEntityRecord>]>();

      const linkedEntities = await Promise.all(
        entityRows.map(async (entityRecord) => {
          const table = entityRecord.table.name;
          if (
            table !== "workspace" &&
            table !== "project" &&
            table !== "person" &&
            table !== "feature" &&
            table !== "task" &&
            table !== "decision" &&
            table !== "question"
          ) {
            return undefined;
          }

          const name = await readEntityName(surreal, entityRecord);
          if (!name) {
            return undefined;
          }

          return {
            id: `${table}:${entityRecord.id as string}`,
            kind: table,
            name,
          };
        }),
      );

      return {
        messageId: `message:${message.id}`,
        conversationId: `conversation:${message.conversationId}`,
        excerpt: message.text.slice(0, 280),
        confidence: Number(message.score.toFixed(4)),
        linkedEntities: linkedEntities.filter((value) => value !== undefined),
      };
    }),
  );

  return {
    query: input.query,
    results: enrichedMessages,
  };
}

export function createGetConversationHistoryTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Search past conversations for discussions about a topic and return relevant message excerpts with linked entities.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Topic to search for"),
      projectId: z.string().optional().describe("Optional project scope filter"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      return executeGetConversationHistory(deps.surreal, context.workspaceRecord, input);
    },
  });
}
