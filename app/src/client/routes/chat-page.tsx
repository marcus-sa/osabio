import { FormEvent, useMemo, useState } from "react";

type EntityKind = "task" | "decision" | "question";

type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  entities?: ExtractedEntity[];
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

export function ChatPage() {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isSending) {
      return;
    }

    setErrorMessage(undefined);
    setIsSending(true);

    const clientMessageId = crypto.randomUUID();
    const requestBody: ChatMessageRequest = {
      clientMessageId,
      text,
    };

    if (conversationId) {
      requestBody.conversationId = conversationId;
    }

    setMessages((existing) => [
      ...existing,
      {
        id: clientMessageId,
        role: "user",
        text,
      },
    ]);

    setInput("");

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
      const message = error instanceof Error ? error.message : "Network error";
      setErrorMessage(message);
      setIsSending(false);
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      setErrorMessage(body);
      setIsSending(false);
      return;
    }

    const payload = (await response.json()) as ChatMessageResponse;
    setConversationId(payload.conversationId);

    setMessages((existing) => [
      ...existing,
      {
        id: payload.messageId,
        role: "assistant",
        text: "",
      },
    ]);

    const stream = new EventSource(payload.streamUrl);
    stream.onmessage = (messageEvent) => {
      const parsed = JSON.parse(messageEvent.data) as ChatStreamEvent;

      if (parsed.type === "token") {
        setMessages((existing) =>
          existing.map((item) =>
            item.id === parsed.messageId
              ? {
                  ...item,
                  text: `${item.text}${parsed.token}`,
                }
              : item,
          ),
        );
        return;
      }

      if (parsed.type === "assistant_message") {
        setMessages((existing) =>
          existing.map((item) =>
            item.id === parsed.messageId
              ? {
                  ...item,
                  text: parsed.text,
                }
              : item,
          ),
        );
        return;
      }

      if (parsed.type === "extraction") {
        setMessages((existing) =>
          existing.map((item) =>
            item.id === parsed.messageId
              ? {
                  ...item,
                  entities: parsed.entities,
                }
              : item,
          ),
        );
        return;
      }

      if (parsed.type === "error") {
        setErrorMessage(parsed.error);
        setIsSending(false);
        stream.close();
        return;
      }

      if (parsed.type === "done") {
        setIsSending(false);
        stream.close();
      }
    };

    stream.onerror = () => {
      setErrorMessage("SSE stream disconnected");
      setIsSending(false);
      stream.close();
    };
  }

  return (
    <section className="chat-page">
      <div className="chat-panel">
        <div className="chat-messages">
          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <header>
                <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
              </header>
              <p>{message.text}</p>
              {message.entities && message.entities.length > 0 ? (
                <ul className="entity-list">
                  {message.entities.map((entity) => (
                    <li key={entity.id}>
                      <span className={`entity-kind ${entity.kind}`}>{entity.kind}</span>
                      <span className="entity-text">{entity.text}</span>
                      <span className="entity-confidence">{entity.confidence.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              ) : undefined}
            </article>
          ))}
        </div>

        <form className="chat-form" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(nextEvent) => setInput(nextEvent.target.value)}
            placeholder="Type a message with a task, decision, or question..."
            rows={4}
          />
          <button type="submit" disabled={!canSend}>
            {isSending ? "Streaming..." : "Send"}
          </button>
        </form>

        {errorMessage ? <p className="error-message">{errorMessage}</p> : undefined}
      </div>
    </section>
  );
}
