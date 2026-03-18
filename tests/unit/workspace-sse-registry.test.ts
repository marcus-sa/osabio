/**
 * Unit tests for per-workspace SSE stream management.
 *
 * Tests the workspace stream extension to SseRegistry:
 * - Register workspace stream, emit events, clients receive them
 * - Multiple clients on same workspace receive same events (fan-out)
 * - Cleanup on client disconnect
 * - Keep-alive interval management
 * - Grace period before full workspace cleanup
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createSseRegistry, type SseRegistry } from "../../app/src/server/streaming/sse-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reads all enqueued chunks from a ReadableStream without blocking. */
async function drainStream(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  // Read available chunks with a short timeout
  const readWithTimeout = async (): Promise<void> => {
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 100),
        ),
      ]);
      if (result.done) break;
      if (result.value) {
        chunks.push(decoder.decode(result.value, { stream: true }));
      }
    }
  };

  await readWithTimeout();
  reader.releaseLock();
  return chunks;
}

/** Parses SSE data lines from raw chunks. */
function parseSseDataLines(chunks: string[]): Array<Record<string, unknown>> {
  const raw = chunks.join("");
  const events: Array<Record<string, unknown>> = [];
  for (const segment of raw.split("\n\n")) {
    for (const line of segment.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.slice("data: ".length)));
        } catch {
          // skip non-JSON (keep-alive comments)
        }
      }
    }
  }
  return events;
}

/** Extracts SSE event type lines from raw chunks. */
function parseSseEventTypes(chunks: string[]): string[] {
  const raw = chunks.join("");
  const types: string[] = [];
  for (const segment of raw.split("\n\n")) {
    for (const line of segment.split("\n")) {
      if (line.startsWith("event: ")) {
        types.push(line.slice("event: ".length));
      }
    }
  }
  return types;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Workspace SSE Registry", () => {
  let registry: SseRegistry;

  beforeEach(() => {
    registry = createSseRegistry();
  });

  afterEach(() => {
    // cleanup any active timers by letting the registry go out of scope
  });

  // -------------------------------------------------------------------------
  // Behavior 1: Register workspace stream and deliver events
  // -------------------------------------------------------------------------
  it("delivers emitted workspace events to a connected client", async () => {
    const workspaceId = "ws-deliver-test";

    // Given a client connected to a workspace stream
    const response = registry.handleWorkspaceStreamRequest(workspaceId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    // Allow stream to initialize
    await new Promise((resolve) => setTimeout(resolve, 50));

    // When a feed_update event is emitted
    const feedEvent = { items: [{ id: "obs-1", type: "observation", tier: "review", title: "Test", created_at: new Date().toISOString() }] };
    registry.emitWorkspaceEvent(workspaceId, feedEvent);

    // Then the client receives the event
    await new Promise((resolve) => setTimeout(resolve, 50));
    const chunks = await drainStream(response);
    const events = parseSseDataLines(chunks);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const received = events.find((e: Record<string, unknown>) =>
      Array.isArray((e as { items?: unknown[] }).items),
    );
    expect(received).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Behavior 2: Multiple clients receive same events (fan-out)
  // -------------------------------------------------------------------------
  it("fans out workspace events to all connected clients", async () => {
    const workspaceId = "ws-fanout-test";

    // Given two clients connected to the same workspace
    const response1 = registry.handleWorkspaceStreamRequest(workspaceId);
    const response2 = registry.handleWorkspaceStreamRequest(workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // When an event is emitted
    const feedEvent = { items: [{ id: "obs-fanout", type: "observation", tier: "review", title: "Fanout test", created_at: new Date().toISOString() }] };
    registry.emitWorkspaceEvent(workspaceId, feedEvent);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then both clients receive the event
    const chunks1 = await drainStream(response1);
    const chunks2 = await drainStream(response2);
    const events1 = parseSseDataLines(chunks1);
    const events2 = parseSseDataLines(chunks2);

    expect(events1.length).toBeGreaterThanOrEqual(1);
    expect(events2.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Behavior 3: SSE format uses event: feed_update and monotonic id
  // -------------------------------------------------------------------------
  it("formats SSE events with event type and monotonic id", async () => {
    const workspaceId = "ws-format-test";

    const response = registry.handleWorkspaceStreamRequest(workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Emit two events
    registry.emitWorkspaceEvent(workspaceId, { items: [{ id: "a", type: "observation", tier: "review", title: "First", created_at: new Date().toISOString() }] });
    registry.emitWorkspaceEvent(workspaceId, { items: [{ id: "b", type: "decision", tier: "blocking", title: "Second", created_at: new Date().toISOString() }] });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const chunks = await drainStream(response);
    const raw = chunks.join("");

    // Verify event type lines
    const eventTypes = parseSseEventTypes(chunks);
    expect(eventTypes.every((t) => t === "feed_update")).toBe(true);
    expect(eventTypes.length).toBeGreaterThanOrEqual(2);

    // Verify monotonic ids (id: N)
    const idMatches = [...raw.matchAll(/^id: (\d+)$/gm)];
    expect(idMatches.length).toBeGreaterThanOrEqual(2);
    if (idMatches.length >= 2) {
      const id1 = parseInt(idMatches[0][1], 10);
      const id2 = parseInt(idMatches[1][1], 10);
      expect(id2).toBeGreaterThan(id1);
    }
  });

  // -------------------------------------------------------------------------
  // Behavior 4: Events not delivered to disconnected workspaces
  // -------------------------------------------------------------------------
  it("does not throw when emitting to a workspace with no clients", () => {
    // Emitting to a non-existent workspace should be a no-op
    expect(() => {
      registry.emitWorkspaceEvent("ws-nonexistent", { items: [] });
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Behavior 5: Keep-alive comment sent on connection
  // -------------------------------------------------------------------------
  it("sends initial keep-alive comment on workspace stream connection", async () => {
    const workspaceId = "ws-keepalive-test";

    const response = registry.handleWorkspaceStreamRequest(workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const chunks = await drainStream(response);
    const raw = chunks.join("");

    // Should contain a keep-alive comment
    expect(raw).toContain(": keep-alive");
  });

  // -------------------------------------------------------------------------
  // Behavior 6: getWorkspaceClientCount returns correct count
  // -------------------------------------------------------------------------
  it("tracks connected client count per workspace", async () => {
    const workspaceId = "ws-count-test";

    expect(registry.getWorkspaceClientCount(workspaceId)).toBe(0);

    const response1 = registry.handleWorkspaceStreamRequest(workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registry.getWorkspaceClientCount(workspaceId)).toBe(1);

    const response2 = registry.handleWorkspaceStreamRequest(workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registry.getWorkspaceClientCount(workspaceId)).toBe(2);
  });
});
