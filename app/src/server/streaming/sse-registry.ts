import type { StreamEvent } from "../../shared/contracts";
import { jsonError } from "../http/response";
import { logInfo, logWarn } from "../http/observability";

type StreamState = {
  queue: StreamEvent[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  finished: boolean;
  keepAliveId?: ReturnType<typeof setInterval>;
};

const encoder = new TextEncoder();

export type SseRegistry = {
  registerMessage: (messageId: string) => void;
  handleStreamRequest: (messageId: string) => Response;
  emitEvent: (messageId: string, event: StreamEvent) => void;
};

export function createSseRegistry(): SseRegistry {
  const streams = new Map<string, StreamState>();

  function cleanupStream(messageId: string, reason: string): void {
    const state = streams.get(messageId);
    if (!state) {
      return;
    }

    if (state.keepAliveId) {
      clearInterval(state.keepAliveId);
    }

    streams.delete(messageId);
    logInfo("sse.stream.closed", "SSE stream closed", { messageId, reason });
  }

  function encodeSse(event: StreamEvent): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
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
        logWarn("sse.stream.not_found", "SSE stream not found", { messageId });
        return jsonError("stream not found", 404);
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          state.controller = controller;
          logInfo("sse.stream.opened", "SSE stream opened", { messageId, queuedEventCount: state.queue.length });

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
  };
}
