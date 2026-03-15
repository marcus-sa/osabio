/**
 * Conversation Upserter — Idempotent DB Adapter
 *
 * Creates or updates a conversation record in SurrealDB using native UPSERT
 * with the deterministic UUIDv5 conversation ID from the hash resolver.
 *
 * Port: (ConversationUpsertInput, Dependencies) -> Promise<RecordId | undefined>
 * Side effects: SurrealDB writes (boundary adapter)
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { logInfo, logError } from "../http/observability";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationUpsertInput = {
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly title: string;
};

type ConversationUpsertDependencies = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a conversation record. Returns the RecordId on success,
 * undefined on failure. Failure never throws -- it logs a warning
 * and returns undefined so the caller can proceed without blocking.
 */
export async function upsertConversation(
  input: ConversationUpsertInput,
  deps: ConversationUpsertDependencies,
): Promise<RecordId | undefined> {
  const conversationRecord = new RecordId("conversation", input.conversationId);
  const workspaceRecord = new RecordId("workspace", input.workspaceId);

  try {
    const results = await deps.surreal.query<[Array<{ id: RecordId }>]>(
      `UPSERT $conversation MERGE {
        workspace: $workspace,
        title: $title,
        title_source: "message",
        source: "proxy",
        createdAt: createdAt ?? time::now(),
        updatedAt: time::now()
      };`,
      {
        conversation: conversationRecord,
        workspace: workspaceRecord,
        title: input.title,
      },
    );

    const record = results[0]?.[0];
    if (record) {
      logInfo("proxy.conversation.upserted", "Proxy conversation upserted", {
        conversation_id: input.conversationId,
        workspace_id: input.workspaceId,
      });
      return record.id;
    }
  } catch (error) {
    logError(
      "proxy.conversation.upsert_failed",
      "Failed to upsert conversation record",
      error,
    );
  }

  return undefined;
}
