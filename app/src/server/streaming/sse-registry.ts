import type { StreamEvent } from "../../shared/contracts";
import { jsonError } from "../http/response";
import { log } from "../telemetry/logger";

type StreamState = {
  queue: StreamEvent[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  finished: boolean;
  keepAliveId?: ReturnType<typeof setInterval>;
};

// ---------------------------------------------------------------------------
// Workspace stream types
// ---------------------------------------------------------------------------

type WorkspaceClient = {
  id: string;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  keepAliveId?: ReturnType<typeof setInterval>;
};

type BufferedEvent = {
  eventId: number;
  encoded: Uint8Array;
};

const EVENT_BUFFER_MAX_SIZE = 1000;

type WorkspaceStreamState = {
  clients: Map<string, WorkspaceClient>;
  eventCounter: number;
  eventBuffer: BufferedEvent[];
  graceTimerId?: ReturnType<typeof setTimeout>;
};

export type WorkspaceStreamEvent = {
  items: Array<{
    id: string;
    type: string;
    tier: string;
    title: string;
    severity?: string;
    source?: string;
    created_at: string;
  }>;
  removals?: string[];
};

const encoder = new TextEncoder();

const KEEP_ALIVE_INTERVAL_MS = 15_000;
const GRACE_PERIOD_MS = 30_000;

export type SseRegistry = {
  registerMessage: (messageId: string) => void;
  handleStreamRequest: (messageId: string) => Response;
  emitEvent: (messageId: string, event: StreamEvent) => void;
  handleWorkspaceStreamRequest: (workspaceId: string, lastEventId?: string) => Response;
  emitWorkspaceEvent: (workspaceId: string, event: WorkspaceStreamEvent) => void;
  getWorkspaceClientCount: (workspaceId: string) => number;
};

/**
 * Resolves which buffered events to replay on reconnection.
 *
 * If lastEventId is provided and found in the buffer, returns events after it.
 * If lastEventId is not found (too old / buffer rotated), returns empty array
 * (caller should treat as no delta available -- client uses GET for full state).
 * If no lastEventId, returns empty array (fresh connection, no replay needed).
 */
function resolveReplayEvents(
  eventBuffer: BufferedEvent[],
  lastEventId: string | undefined,
): BufferedEvent[] {
  if (!lastEventId) return [];

  const parsedId = parseInt(lastEventId, 10);
  if (isNaN(parsedId)) return [];

  // Find the index of the event matching lastEventId
  const lastSeenIndex = eventBuffer.findIndex((e) => e.eventId === parsedId);

  if (lastSeenIndex === -1) {
    // ID not in buffer -- too old or unknown. No delta available.
    // If buffer has events and they're all newer, replay all of them
    if (eventBuffer.length > 0 && eventBuffer[0].eventId > parsedId) {
      return [...eventBuffer];
    }
    return [];
  }

  // Return everything after the last seen event
  return eventBuffer.slice(lastSeenIndex + 1);
}

export function createSseRegistry(): SseRegistry {
  const streams = new Map<string, StreamState>();
  const workspaceStreams = new Map<string, WorkspaceStreamState>();

  function cleanupStream(messageId: string, reason: string): void {
    const state = streams.get(messageId);
    if (!state) {
      return;
    }

    if (state.keepAliveId) {
      clearInterval(state.keepAliveId);
    }

    streams.delete(messageId);
    log.info("sse.stream.closed", "SSE stream closed", { messageId, reason });
  }

  function encodeSse(event: StreamEvent): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  }

  function encodeWorkspaceSse(eventId: number, event: WorkspaceStreamEvent): Uint8Array {
    return encoder.encode(
      `id: ${eventId}\nevent: feed_update\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }

  function getOrCreateWorkspaceState(workspaceId: string): WorkspaceStreamState {
    let state = workspaceStreams.get(workspaceId);
    if (!state) {
      state = { clients: new Map(), eventCounter: 0, eventBuffer: [] };
      workspaceStreams.set(workspaceId, state);
    }
    // Cancel grace period if new client joins
    if (state.graceTimerId) {
      clearTimeout(state.graceTimerId);
      state.graceTimerId = undefined;
    }
    return state;
  }

  function removeWorkspaceClient(workspaceId: string, clientId: string): void {
    const state = workspaceStreams.get(workspaceId);
    if (!state) return;

    const client = state.clients.get(clientId);
    if (client?.keepAliveId) {
      clearInterval(client.keepAliveId);
    }
    state.clients.delete(clientId);

    log.info("sse.workspace.client_removed", "Workspace SSE client removed", {
      workspaceId,
      clientId,
      remainingClients: state.clients.size,
    });

    if (state.clients.size === 0) {
      // Start grace period before full cleanup
      state.graceTimerId = setTimeout(() => {
        const current = workspaceStreams.get(workspaceId);
        if (current && current.clients.size === 0) {
          workspaceStreams.delete(workspaceId);
          log.info("sse.workspace.cleaned_up", "Workspace stream cleaned up after grace period", { workspaceId });
        }
      }, GRACE_PERIOD_MS);
    }
  }

  return {
    registerMessage(messageId: string): void {
      streams.set(messageId, {
        queue: [],
        finished: false,
      });
    },

    handleStreamRequest(messageId: string): Response {
      const state = streams.get(messageId);
      if (!state) {
        log.warn("sse.stream.not_found", "SSE stream not found", { messageId });
        return jsonError("stream not found", 404);
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          state.controller = controller;
          log.info("sse.stream.opened", "SSE stream opened", { messageId, queuedEventCount: state.queue.length });

          for (const event of state.queue) {
            controller.enqueue(encodeSse(event));
          }
          state.queue = [];

          if (state.finished) {
            controller.close();
            cleanupStream(messageId, "finished_before_start");
            return;
          }

          // Send immediate keep-alive so the EventSource confirms the connection
          controller.enqueue(encoder.encode(": keep-alive\n\n"));

          state.keepAliveId = setInterval(() => {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }, 15_000);
        },
        cancel() {
          cleanupStream(messageId, "client_cancelled");
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },

    emitEvent(messageId: string, event: StreamEvent): void {
      const state = streams.get(messageId);
      if (!state) {
        return;
      }

      if (state.controller) {
        state.controller.enqueue(encodeSse(event));
      } else {
        state.queue.push(event);
      }

      if (event.type === "done" || event.type === "error") {
        state.finished = true;
        if (state.controller) {
          state.controller.close();
          cleanupStream(messageId, event.type === "done" ? "completed" : "error_event");
        }
      }
    },

    // -----------------------------------------------------------------------
    // Workspace stream methods
    // -----------------------------------------------------------------------

    handleWorkspaceStreamRequest(workspaceId: string, lastEventId?: string): Response {
      const state = getOrCreateWorkspaceState(workspaceId);
      const clientId = `client-${crypto.randomUUID()}`;
      const client: WorkspaceClient = { id: clientId };
      state.clients.set(clientId, client);

      // Determine which buffered events to replay on reconnection
      const eventsToReplay = resolveReplayEvents(state.eventBuffer, lastEventId);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          client.controller = controller;

          log.info("sse.workspace.client_connected", "Workspace SSE client connected", {
            workspaceId,
            clientId,
            totalClients: state.clients.size,
            lastEventId: lastEventId ?? "none",
            replayCount: eventsToReplay.length,
          });

          // Send immediate keep-alive so EventSource confirms the connection
          controller.enqueue(encoder.encode(": keep-alive\n\n"));

          // Replay missed events from the buffer (delta sync)
          for (const buffered of eventsToReplay) {
            controller.enqueue(buffered.encoded);
          }

          client.keepAliveId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              // Controller may be closed; cleanup will handle it
              removeWorkspaceClient(workspaceId, clientId);
            }
          }, KEEP_ALIVE_INTERVAL_MS);
        },
        cancel() {
          removeWorkspaceClient(workspaceId, clientId);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },

    emitWorkspaceEvent(workspaceId: string, event: WorkspaceStreamEvent): void {
      const state = workspaceStreams.get(workspaceId);
      if (!state) return;

      state.eventCounter += 1;
      const eventId = state.eventCounter;
      const encoded = encodeWorkspaceSse(eventId, event);

      // Store in bounded event buffer for delta sync on reconnection
      state.eventBuffer.push({ eventId, encoded });
      if (state.eventBuffer.length > EVENT_BUFFER_MAX_SIZE) {
        state.eventBuffer.splice(0, state.eventBuffer.length - EVENT_BUFFER_MAX_SIZE);
      }

      for (const client of state.clients.values()) {
        if (client.controller) {
          try {
            client.controller.enqueue(encoded);
          } catch {
            // Client controller closed; remove on next tick
            removeWorkspaceClient(workspaceId, client.id);
          }
        }
      }
    },

    getWorkspaceClientCount(workspaceId: string): number {
      const state = workspaceStreams.get(workspaceId);
      return state ? state.clients.size : 0;
    },
  };
}
