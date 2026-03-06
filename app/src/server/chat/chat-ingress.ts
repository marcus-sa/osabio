import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import type { ChatMessageResponse } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { elapsedMs, logDebug, logError, logInfo, logWarn } from "../http/observability";
import { parseIncomingMessageRequest } from "../http/parsing";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import type { ConversationRow, WorkspaceRow } from "../extraction/types";
import { parseRecordIdString } from "../graph/queries";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { deriveMessageTitle } from "../workspace/conversation-sidebar";
import { processChatMessage } from "./chat-processor";

export function createChatIngressHandlers(deps: ServerDependencies): {
  handlePostChatMessage: (request: Request) => Promise<Response>;
  handleChatStream: (messageId: string) => Response;
} {
  return {
    handlePostChatMessage: (request: Request) => handlePostChatMessage(deps, request),
    handleChatStream: (messageId: string) => deps.sse.handleStreamRequest(messageId),
  };
}

async function handlePostChatMessage(deps: ServerDependencies, request: Request): Promise<Response> {
  const startedAt = performance.now();
  logInfo("chat.message.ingress.started", "Chat message ingress started");

  let parsed: Awaited<ReturnType<typeof parseIncomingMessageRequest>>;
  try {
    parsed = await parseIncomingMessageRequest(request);
  } catch (error) {
    logError("chat.message.parse.failed", "Parsing incoming chat message failed", error);
    const errorText = error instanceof Error ? error.message : "invalid request body";
    return jsonError(errorText, 400);
  }

  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const conversationId = parsed.data.conversationId ?? randomUUID();
  const messageId = randomUUID();
  const workspaceId = parsed.data.workspaceId;
  const userText = parsed.data.text.trim();
  const onboardingAction = parsed.data.onboardingAction;
  const messageText = userText.length > 0 ? userText : `Uploaded document: ${parsed.data.attachment?.fileName ?? "attachment"}`;
  const userMessageRecord = new RecordId("message", randomUUID());

  logDebug("http.request.validated", "Chat message request validated", {
    workspaceId,
    conversationId,
    hasAttachment: parsed.data.attachment !== undefined,
  });

  let workspaceRecord: RecordId<"workspace", string>;

  try {
    logInfo("chat.message.persist.started", "Persisting user chat message", {
      workspaceId,
      conversationId,
      messageId,
    });

    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    const workspace = await deps.surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      throw new HttpError(404, `workspace not found: ${workspaceId}`);
    }

    const discussEntityTables = ["project", "person", "feature", "task", "decision", "question", "observation"] as const;
    const discussesRecord = parsed.data.discussEntityId
      ? parseRecordIdString(parsed.data.discussEntityId, [...discussEntityTables])
      : undefined;

    const now = new Date();
    const conversationRecord = new RecordId("conversation", conversationId);
    const existingConversation = await deps.surreal.select<ConversationRow>(conversationRecord);

    const transaction = await deps.surreal.beginTransaction();
    try {
      if (existingConversation) {
        if (!existingConversation.workspace) {
          throw new HttpError(500, "conversation is missing workspace scope");
        }

        if (existingConversation.workspace.id !== workspaceRecord.id) {
          throw new HttpError(400, "conversation scope does not match workspaceId");
        }

        await transaction.update(conversationRecord).merge({
          updatedAt: now,
        });
      } else {
        await transaction.create(conversationRecord).content({
          createdAt: now,
          updatedAt: now,
          workspace: workspaceRecord,
          title: deriveMessageTitle(messageText),
          title_source: "message",
          ...(workspace.onboarding_complete ? {} : { source: "onboarding" }),
          ...(discussesRecord ? { discusses: discussesRecord } : {}),
        });
      }

      await transaction.create(userMessageRecord).content({
        conversation: conversationRecord,
        role: "user",
        text: messageText,
        createdAt: now,
        clientMessageId: parsed.data.clientMessageId,
      });

      if (!workspace.onboarding_complete) {
        await transaction.update(workspaceRecord).merge({
          onboarding_turn_count: workspace.onboarding_turn_count + 1,
          updated_at: now,
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.cancel();
      throw error;
    }

    logInfo("chat.message.persist.completed", "User chat message persisted", {
      workspaceId,
      conversationId,
      messageId,
      userMessageId: userMessageRecord.id as string,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("chat.message.persist.http_error", "Chat message persistence failed with client-facing error", {
        workspaceId,
        conversationId,
        messageId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("chat.message.persist.failed", "Persisting user chat message failed", error, {
      workspaceId,
      conversationId,
      messageId,
    });
    const errorText = error instanceof Error ? error.message : "failed to persist user message";
    return jsonError(errorText, 500);
  }

  deps.sse.registerMessage(messageId);

  const session = await deps.auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("authentication required", 401);
  }
  const personRecord = new RecordId("person", session.user.id);

  logInfo("chat.message.process.started", "Async chat processing started", {
    workspaceId,
    conversationId,
    messageId,
  });

  void processChatMessage({
    deps,
    conversationId,
    messageId,
    workspaceRecord,
    userMessageRecord,
    userText: messageText,
    attachment: parsed.data.attachment,
    ...(onboardingAction ? { onboardingAction } : {}),
    personRecord,
  });

  const response: ChatMessageResponse = {
    messageId,
    userMessageId: userMessageRecord.id as string,
    conversationId,
    workspaceId,
    streamUrl: `/api/chat/stream/${messageId}`,
  };

  logInfo("chat.message.ingress.completed", "Chat message ingress completed", {
    workspaceId,
    conversationId,
    messageId,
    durationMs: elapsedMs(startedAt),
  });

  return jsonResponse(response, 200);
}
