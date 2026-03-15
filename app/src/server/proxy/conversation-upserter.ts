/**
 * Conversation Upserter — Idempotent DB Adapter
 *
 * Creates or retrieves a conversation record in SurrealDB using the
 * deterministic UUIDv5 conversation ID from the hash resolver.
 *
 * Idempotent: attempts CREATE conversation:<uuidv5>, catches duplicate
 * error, then queries existing record via SELECT.
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

  const now = new Date();

  try {
    // Attempt CREATE -- will succeed on first request, fail on duplicate
    await deps.surreal.query(`CREATE $conversation CONTENT $content;`, {
      conversation: conversationRecord,
      content: {
        workspace: workspaceRecord,
        title: input.title,
        title_source: "message",
        source: "proxy",
        createdAt: now,
        updatedAt: now,
      },
    });

    logInfo("proxy.conversation.created", "Proxy conversation created", {
      conversation_id: input.conversationId,
      workspace_id: input.workspaceId,
    });

    return conversationRecord;
  } catch (error) {
    // Duplicate key -- conversation already exists, retrieve it
    const errorMessage = String(error);
    if (
      errorMessage.includes("already exists") ||
      errorMessage.includes("Database record")
    ) {
      try {
        const results = await deps.surreal.query<[Array<{ id: RecordId }>]>(
          `SELECT id FROM $conversation;`,
          { conversation: conversationRecord },
        );

        const existing = results[0]?.[0];
        if (existing) {
          // Update the updatedAt timestamp on re-use
          await deps.surreal.query(
            `UPDATE $conversation SET updatedAt = $now;`,
            { conversation: conversationRecord, now: new Date() },
          );

          logInfo("proxy.conversation.reused", "Proxy conversation reused", {
            conversation_id: input.conversationId,
          });
          return existing.id;
        }
      } catch (selectError) {
        logError(
          "proxy.conversation.select_failed",
          "Failed to retrieve existing conversation after duplicate",
          selectError,
        );
      }
    } else {
      logError(
        "proxy.conversation.create_failed",
        "Failed to create conversation record",
        error,
      );
    }
  }

  return undefined;
}
