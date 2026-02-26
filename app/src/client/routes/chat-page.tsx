import { useMemo, useRef, useState } from "react";
import {
  Chat,
  ChatInput,
  SessionMessagePanel,
  SessionMessages,
  SessionMessagesHeader,
  type MentionItem,
  type Session,
  type SlashCommandItem,
} from "reachat";

type EntityKind = "task" | "decision" | "question";
type RelationshipKind = "BELONGS_TO" | "DEPENDS_ON";

type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

type ExtractedRelationship = {
  id: string;
  type: RelationshipKind;
  fromText: string;
  toText: string;
  confidence: number;
  sourceMessageId: string;
};

type ChatMessageRequest = {
  clientMessageId: string;
  conversationId?: string;
  text: string;
};

type ChatMessageResponse = {
  messageId: string;
  conversationId: string;
  streamUrl: string;
};

type TokenEvent = {
  type: "token";
  messageId: string;
  token: string;
};

type AssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  text: string;
};

type ExtractionEvent = {
  type: "extraction";
  messageId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
};

type DoneEvent = {
  type: "done";
  messageId: string;
};

type ErrorEvent = {
  type: "error";
  messageId: string;
  error: string;
};

type ChatStreamEvent = TokenEvent | AssistantMessageEvent | ExtractionEvent | DoneEvent | ErrorEvent;

type SearchEntityResponse = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

const COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "task",
    label: "task",
    description: "Record a task",
    type: "insert",
    value: "task: ",
  },
  {
    id: "decision",
    label: "decision",
    description: "Record a decision",
    type: "insert",
    value: "decision: ",
  },
  {
    id: "question",
    label: "question",
    description: "Record an open question",
    type: "insert",
    value: "question: ",
  },
];

export function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([
    {
      id: "phase-1",
      title: "Phase 1",
      createdAt: new Date(),
      updatedAt: new Date(),
      conversations: [],
    },
  ]);
  const [activeSessionId] = useState("phase-1");
  const [backendConversationId, setBackendConversationId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const streamRef = useRef<EventSource | undefined>(undefined);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );

  if (!activeSession) {
    throw new Error("active session missing");
  }

  async function searchMentions(query: string): Promise<MentionItem[]> {
    const response = await fetch(`/api/entities/search?q=${encodeURIComponent(query)}&limit=8`);
    if (!response.ok) {
      throw new Error(`entity search failed: ${response.status}`);
    }

    const rows = (await response.json()) as SearchEntityResponse[];
    return rows.map((row) => ({
      id: row.id,
      label: `${row.kind}: ${row.text.slice(0, 48)}`,
      description: `confidence ${row.confidence.toFixed(2)}`,
      value: `@${row.kind}:${row.id}`,
    }));
  }

  async function onSendMessage(message: string) {
    if (isLoading) {
      return;
    }

    const text = message.trim();
    if (!text) {
      return;
    }

    setErrorMessage(undefined);
    setIsLoading(true);

    const clientMessageId = crypto.randomUUID();
    const requestBody: ChatMessageRequest = {
      clientMessageId,
      text,
    };

    if (backendConversationId) {
      requestBody.conversationId = backendConversationId;
    }

    setSessions((existing) =>
      existing.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              updatedAt: new Date(),
              conversations: [
                ...session.conversations,
                {
                  id: clientMessageId,
                  question: text,
                  createdAt: new Date(),
                },
              ],
            }
          : session,
      ),
    );

    let response: Response;
    try {
      response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Network error";
      setErrorMessage(messageText);
      setIsLoading(false);
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      setErrorMessage(body);
      setIsLoading(false);
      return;
    }

    const payload = (await response.json()) as ChatMessageResponse;
    setBackendConversationId(payload.conversationId);

    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = undefined;
    }

    let streamedText = "";
    let extractedEntities: ExtractedEntity[] = [];
    let extractedRelationships: ExtractedRelationship[] = [];

    const stream = new EventSource(payload.streamUrl);
    streamRef.current = stream;

    stream.onmessage = (messageEvent) => {
      const parsed = JSON.parse(messageEvent.data) as ChatStreamEvent;

      if (parsed.type === "token") {
        streamedText = `${streamedText}${parsed.token}`;
        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: streamedText,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );
        return;
      }

      if (parsed.type === "assistant_message") {
        streamedText = parsed.text;
        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: streamedText,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );
        return;
      }

      if (parsed.type === "extraction") {
        extractedEntities = parsed.entities;
        extractedRelationships = parsed.relationships;
        return;
      }

      if (parsed.type === "error") {
        setErrorMessage(parsed.error);
        setIsLoading(false);
        stream.close();
        streamRef.current = undefined;
        return;
      }

      if (parsed.type === "done") {
        const entitySummary = extractedEntities
          .map((entity) => `- ${entity.kind}: ${entity.text} (${entity.confidence.toFixed(2)})`)
          .join("\n");
        const relationshipSummary = extractedRelationships
          .map(
            (relationship) =>
              `- ${relationship.type}: ${relationship.fromText} -> ${relationship.toText} (${relationship.confidence.toFixed(2)})`,
          )
          .join("\n");

        const extractionSummary = [
          entitySummary ? `\n\nExtracted entities:\n${entitySummary}` : "",
          relationshipSummary ? `\n\nExtracted relationships:\n${relationshipSummary}` : "",
        ].join("");

        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  updatedAt: new Date(),
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: `${streamedText}${extractionSummary}`,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );

        setIsLoading(false);
        stream.close();
        streamRef.current = undefined;
      }
    };

    stream.onerror = () => {
      setErrorMessage("SSE stream disconnected");
      setIsLoading(false);
      stream.close();
      streamRef.current = undefined;
    };
  }

  function onStopMessage() {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.close();
    streamRef.current = undefined;
    setIsLoading(false);
  }

  return (
    <section className="reachat-page">
      <Chat
        viewType="chat"
        sessions={sessions}
        activeSessionId={activeSession.id}
        isLoading={isLoading}
        onSendMessage={onSendMessage}
        onStopMessage={onStopMessage}
      >
        <SessionMessagePanel>
          <SessionMessagesHeader>
            <div className="reachat-header">Phase 1 Chat + Extraction</div>
          </SessionMessagesHeader>
          <SessionMessages />
          <ChatInput
            placeholder="Discuss tasks, decisions, and questions..."
            mentions={{
              onSearch: searchMentions,
            }}
            commands={{
              items: COMMAND_ITEMS,
            }}
          />
        </SessionMessagePanel>
      </Chat>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : undefined}
    </section>
  );
}
