import { randomUUID } from "node:crypto";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { RecordId } from "surrealdb";
import type { OnboardingAction, SubagentTrace } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { elapsedMs, logError, logInfo, logWarn } from "../http/observability";
import { jsonError } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import type { ConversationRow, WorkspaceRow } from "../extraction/types";
import { parseRecordIdString, getWorkspaceOwnerRecord } from "../graph/queries";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { deriveMessageTitle, refreshConversationTouchedBy, maybeUpgradeConversationTitle } from "../workspace/conversation-sidebar";
import { buildChatContext, buildSystemPrompt } from "./context";
import { createChatAgentTools } from "./tools";
import { transitionOnboardingState } from "../onboarding/onboarding-state";
import { createEmbedding, persistEmbeddings } from "../extraction/embedding-writeback";
import { loadBranchChain } from "./branch-chain";
import { persistSubagentTrace } from "./trace-loader";

type ChatRequestBody = {
  messages: UIMessage[];
  workspaceId: string;
  conversationId?: string;
  onboardingAction?: OnboardingAction;
  discussEntityId?: string;
};

const onboardingActions = new Set(["finalize_onboarding", "continue_onboarding"]);

export function createChatRouteHandler(deps: ServerDependencies) {
  return (request: Request) => handleChatRequest(deps, request);
}

async function handleChatRequest(deps: ServerDependencies, request: Request): Promise<Response> {
  const startedAt = performance.now();

  let body: ChatRequestBody;
  try {
    body = await request.json() as ChatRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  if (!body.workspaceId || body.workspaceId.trim().length === 0) {
    return jsonError("workspaceId is required", 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError("messages array is required", 400);
  }
  if (body.onboardingAction && !onboardingActions.has(body.onboardingAction)) {
    return jsonError("onboardingAction must be finalize_onboarding or continue_onboarding", 400);
  }

  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== "user") {
    return jsonError("last message must be a user message", 400);
  }

  const userText = extractTextFromUIMessage(lastMessage);
  if (userText.trim().length === 0) {
    return jsonError("user message text is required", 400);
  }

  const conversationId = body.conversationId ?? randomUUID();
  const messageId = randomUUID();
  const userMessageRecord = new RecordId("message", randomUUID());

  let workspaceRecord: RecordId<"workspace", string>;

  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, body.workspaceId);
    const workspace = await deps.surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      throw new HttpError(404, `workspace not found: ${body.workspaceId}`);
    }

    const discussEntityTables = ["project", "person", "feature", "task", "decision", "question", "observation"] as const;
    const discussesRecord = body.discussEntityId
      ? parseRecordIdString(body.discussEntityId, [...discussEntityTables])
      : undefined;

    const now = new Date();
    const conversationRecord = new RecordId("conversation", conversationId);
    const existingConversation = await deps.surreal.select<ConversationRow>(conversationRecord);

    // Persist user message in transaction
    const transaction = await deps.surreal.beginTransaction();
    try {
      if (existingConversation) {
        if (!existingConversation.workspace) {
          throw new HttpError(500, "conversation is missing workspace scope");
        }
        if (existingConversation.workspace.id !== workspaceRecord.id) {
          throw new HttpError(400, "conversation scope does not match workspaceId");
        }
        await transaction.update(conversationRecord).merge({ updatedAt: now });
      } else {
        await transaction.create(conversationRecord).content({
          createdAt: now,
          updatedAt: now,
          workspace: workspaceRecord,
          title: deriveMessageTitle(userText),
          title_source: "message",
          ...(workspace.onboarding_complete ? {} : { source: "onboarding" }),
          ...(discussesRecord ? { discusses: discussesRecord } : {}),
        });
      }

      await transaction.create(userMessageRecord).content({
        conversation: conversationRecord,
        role: "user",
        text: userText,
        createdAt: now,
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

    // Embed user message (fire-and-forget)
    const userMessageEmbedding = await createEmbedding(deps.embeddingModel, deps.config.embeddingDimension, userText);
    if (userMessageEmbedding) {
      deps.inflight.track(deps.surreal
        .query("UPDATE $record MERGE { embedding: $embedding };", {
          record: userMessageRecord,
          embedding: userMessageEmbedding,
        })
        .catch(() => undefined));
    }

    // Compute onboarding state
    const onboardingAfter = await transitionOnboardingState({
      surreal: deps.surreal,
      workspaceRecord,
      workspace,
      onboardingAction: body.onboardingAction,
      now,
    });

    // Load branch context
    const branchChain = await loadBranchChain(deps.surreal, conversationId);
    let inheritedEntityIds: RecordId[] | undefined;
    if (branchChain.length > 0) {
      const inheritedMsgIds = branchChain.map((b) => new RecordId("message", b));
      if (inheritedMsgIds.length > 0) {
        const [entityRows] = await deps.surreal
          .query<[Array<{ out: RecordId }>]>(
            "SELECT DISTINCT out FROM extraction_relation WHERE `in` IN $msgIds LIMIT 30;",
            { msgIds: inheritedMsgIds },
          )
          .collect<[Array<{ out: RecordId }>]>();
        inheritedEntityIds = entityRows.map((r) => r.out);
      }
    }

    const workspaceOwnerRecord = await getWorkspaceOwnerRecord({
      surreal: deps.surreal,
      workspaceRecord,
    });

    // Build chat context and system prompt
    const context = await buildChatContext({
      surreal: deps.surreal,
      conversationRecord,
      workspaceRecord,
      ...(userMessageEmbedding ? { userMessageEmbedding } : {}),
      ...(inheritedEntityIds && inheritedEntityIds.length > 0 ? { inheritedEntityIds } : {}),
      ...(existingConversation?.discusses ? { discussesRecord: existingConversation.discusses } : {}),
    });

    const system = buildSystemPrompt(context, {
      isOnboarding: onboardingAfter !== "complete",
      onboardingState: onboardingAfter,
    });

    // Convert UIMessages to model messages
    const modelMessages = await convertToModelMessages(body.messages);

    const tools = createChatAgentTools({
      surreal: deps.surreal,
      pmAgentModel: deps.pmAgentModel,
      analyticsAgentModel: deps.analyticsAgentModel,
      analyticsSurreal: deps.analyticsSurreal,
      embeddingModel: deps.embeddingModel,
      embeddingDimension: deps.config.embeddingDimension,
      extractionModelId: deps.config.extractionModelId,
      extractionModel: deps.extractionModel,
      extractionStoreThreshold: deps.config.extractionStoreThreshold,
    });

    // Stream the response
    const result = streamText({
      model: deps.chatAgentModel,
      system,
      messages: modelMessages,
      tools,
      experimental_context: {
        actor: "chat_agent",
        workspaceRecord,
        conversationRecord,
        currentMessageRecord: userMessageRecord,
        latestUserText: userText,
        ...(workspaceOwnerRecord ? { workspaceOwnerRecord } : {}),
      },
      stopWhen: stepCountIs(5),
    });

    logInfo("chat.route.streaming", "Streaming chat response", {
      conversationId,
      messageId,
      workspaceId: body.workspaceId,
      durationMs: elapsedMs(startedAt),
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      onFinish: async ({ responseMessage }) => {
        const rawText = responseMessage.parts
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const assistantText = rawText.trim().length > 0
          ? rawText.trim()
          : "I could not generate a response for that request.";

        // Extract subagent traces from tool parts
        const subagentTraces: SubagentTrace[] = [];
        for (const part of responseMessage.parts) {
          if (part.type === "tool-invoke_pm_agent" && "state" in part && part.state === "output-available" && "output" in part) {
            const output = part.output as Record<string, unknown> | undefined;
            if (output?.trace) {
              subagentTraces.push(output.trace as SubagentTrace);
            }
          }
        }

        // Persist assistant message (traces stored separately in trace table)
        const assistantMessageRecord = new RecordId("message", messageId);
        await deps.surreal.create(assistantMessageRecord).content({
          conversation: conversationRecord,
          role: "assistant",
          text: assistantText,
          createdAt: now,
        });

        // Persist subagent traces as normalized trace records with spawns edges
        if (subagentTraces.length > 0) {
          const actorRecord = workspaceOwnerRecord ?? new RecordId("identity", "unknown");
          deps.inflight.track(
            Promise.all(
              subagentTraces.map((trace) =>
                persistSubagentTrace(deps.surreal, assistantMessageRecord, workspaceRecord, actorRecord, trace),
              ),
            ).catch((err) => {
              logError("chat.route.trace_persist_failed", "Failed to persist subagent traces", { error: String(err) });
            }),
          );
        }

        await deps.surreal.update(conversationRecord).merge({ updatedAt: now });

        // Post-response hooks
        await refreshConversationTouchedBy(deps.surreal, conversationRecord);
        await maybeUpgradeConversationTitle(deps.surreal, conversationRecord);

        // Fire-and-forget: embeddings
        deps.inflight.track(persistEmbeddings({
          surreal: deps.surreal,
          embeddingModel: deps.embeddingModel,
          embeddingDimension: deps.config.embeddingDimension,
          assistantMessageRecord,
          assistantText,
          entities: [],
        }).catch(() => undefined));

        logInfo("chat.route.completed", "Chat response completed", {
          conversationId,
          messageId,
          workspaceId: body.workspaceId,
          durationMs: elapsedMs(startedAt),
        });
      },
      messageMetadata: ({ part }) => {
        if (part.type === "finish") {
          return { onboardingState: onboardingAfter, conversationId };
        }
        return { onboardingState: onboardingAfter, conversationId };
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("chat.route.http_error", "Chat route failed with client-facing error", {
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("chat.route.failed", "Chat route failed", error, {
      conversationId,
      messageId,
      durationMs: elapsedMs(startedAt),
    });
    return jsonError("chat processing failed", 500);
  }
}

function extractTextFromUIMessage(message: UIMessage): string {
  for (const part of message.parts) {
    if (part.type === "text") {
      return part.text;
    }
  }
  return "";
}
