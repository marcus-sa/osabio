const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const requestTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? "90000");

const messageText =
  "Task: ship OAuth callback handler this week. Decision: use OpenRouter embeddings first. Question: do we keep a fallback provider? The OAuth task blocks API integration.";

await run();

export {};

async function run(): Promise<void> {
  console.log(`Running Phase 1 smoke against ${baseUrl}`);

  const health = await fetchJson<{ status: string }>(`${baseUrl}/healthz`);
  assert(health.status === "ok", "healthz status was not ok");
  console.log("healthz check passed");

  const chatResponse = await fetchJson<{
    messageId: string;
    conversationId: string;
    streamUrl: string;
  }>(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientMessageId: crypto.randomUUID(),
      text: messageText,
    }),
  });

  assert(typeof chatResponse.messageId === "string" && chatResponse.messageId.length > 0, "messageId missing");
  assert(
    typeof chatResponse.conversationId === "string" && chatResponse.conversationId.length > 0,
    "conversationId missing",
  );
  assert(typeof chatResponse.streamUrl === "string" && chatResponse.streamUrl.length > 0, "streamUrl missing");
  console.log("chat metadata check passed");

  const events = await collectSseEvents(`${baseUrl}${chatResponse.streamUrl}`, requestTimeoutMs);
  const eventTypes = events.map((event) => event.type);

  assert(eventTypes.includes("token"), "stream did not emit token events");
  assert(eventTypes.includes("extraction"), "stream did not emit extraction event");
  assert(eventTypes.includes("assistant_message"), "stream did not emit assistant_message event");
  assert(eventTypes[eventTypes.length - 1] === "done", "stream did not end with done");

  const extractionEvent = events.find((event) => event.type === "extraction");
  assert(Boolean(extractionEvent), "missing extraction event payload");
  if (!extractionEvent || extractionEvent.type !== "extraction") {
    throw new Error("missing extraction event payload");
  }

  assert(extractionEvent.entities.length > 0, "no extracted entities were emitted");

  const firstEntity = extractionEvent.entities[0];
  const searchTerm = firstEntity.text.split(/\s+/).slice(0, 3).join(" ").trim();
  const query = searchTerm.length > 0 ? searchTerm : "task";

  const rows = await fetchJson<
    Array<{ id: string; kind: string; text: string; confidence: number; sourceMessageId: string }>
  >(`${baseUrl}/api/entities/search?q=${encodeURIComponent(query)}&limit=10`);

  assert(rows.length > 0, "entity search returned no rows");
  for (const row of rows) {
    assert(typeof row.id === "string" && row.id.length > 0, "search row id missing");
    assert(typeof row.kind === "string" && row.kind.length > 0, "search row kind missing");
    assert(typeof row.text === "string" && row.text.length > 0, "search row text missing");
    assert(typeof row.confidence === "number", "search row confidence missing");
    assert(
      typeof row.sourceMessageId === "string" && row.sourceMessageId.length > 0,
      "search row sourceMessageId missing",
    );
  }

  console.log("search check passed");
  console.log("Phase 1 smoke passed");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

type SmokeStreamEvent =
  | {
      type: "token";
      messageId: string;
      token: string;
    }
  | {
      type: "assistant_message";
      messageId: string;
      text: string;
    }
  | {
      type: "extraction";
      messageId: string;
      entities: Array<{
        id: string;
        kind: string;
        text: string;
        confidence: number;
        sourceMessageId: string;
      }>;
      relationships: Array<{
        id: string;
        kind: string;
        fromId: string;
        toId: string;
        confidence: number;
        sourceMessageId: string;
      }>;
    }
  | {
      type: "done";
      messageId: string;
    }
  | {
      type: "error";
      messageId: string;
      error: string;
    };

async function collectSseEvents(streamUrl: string, timeoutMs: number): Promise<SmokeStreamEvent[]> {
  const response = await fetch(streamUrl, { headers: { Accept: "text/event-stream" } });
  if (!response.ok) {
    throw new Error(`Failed to open SSE stream (${response.status})`);
  }
  if (!response.body) {
    throw new Error("SSE stream response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SmokeStreamEvent[] = [];
  let buffer = "";

  const timeout = setTimeout(() => {
    void reader.cancel();
  }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const dataLine = segment
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) {
          continue;
        }

        const payload = dataLine.slice("data: ".length);
        const event = JSON.parse(payload) as SmokeStreamEvent;
        events.push(event);

        if (event.type === "done") {
          return events;
        }

        if (event.type === "error") {
          throw new Error(`SSE error event: ${event.error}`);
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return events;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
