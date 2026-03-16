# Streaming

SSE (Server-Sent Events) state management — bridges the gap between response generation and client connection with event queuing and lazy binding.

## The Problem

Chat responses are generated asynchronously — the server starts producing events before the client has connected to the SSE stream. Without a registry, early events are lost. The streaming module queues events when no client is connected and flushes them when the client binds, ensuring zero event loss regardless of connection timing.

## What It Does

- **Stream registration**: Pre-registers a message stream before response generation begins
- **Event queuing**: Buffers events when no SSE controller is bound yet
- **Lazy binding**: Client connects → controller bound → queued events flushed immediately
- **Keep-alive heartbeat**: 15-second heartbeat prevents connection timeouts
- **Auto-cleanup**: Stream state cleaned up on `done`, `error`, or client disconnect

## Key Concepts

| Term | Definition |
|------|------------|
| **StreamState** | In-memory state per message: controller (if bound), event queue, done flag |
| **SseRegistry** | `Map<messageId, StreamState>` — the central registry for all active streams |
| **Lazy Binding** | Controller is set when the client actually connects, not when the stream is registered |
| **Event Queue** | FIFO buffer for events emitted before client connection — flushed on bind |

## How It Works

1. `chat-ingress.ts` calls `sseRegistry.registerMessage(messageId)` → creates `StreamState` with empty queue
2. `chat-processor.ts` starts generating response → calls `sseRegistry.emitEvent(messageId, event)`
3. If no client connected yet → events queued in `StreamState.queue`
4. Client connects: `GET /api/chat/stream/:messageId` → `handleStreamRequest()` binds controller
5. Queued events flushed immediately → new events emitted directly
6. On `done` or `error` event → stream closed, state cleaned up

## Where It Fits

```text
chat-ingress.ts                    Client (browser)
  |                                    |
  v                                    |
registerMessage(messageId)             |
  |                                    |
  v                                    |
chat-processor.ts                      |
  |                                    |
  +---> emitEvent(token)               |
  +---> emitEvent(extraction)          |
  |     [queued if no client]          |
  |                                    v
  |                              GET /stream/:messageId
  |                                    |
  |                                    v
  |                              handleStreamRequest()
  |                                    |
  +---> emitEvent(assistant_message)   +---> flush queue
  +---> emitEvent(done)               +---> stream events
  |                                    |
  v                                    v
cleanup StreamState              connection closed
```

**Consumes**: Stream events from chat processor and orchestrator
**Produces**: SSE event stream to connected clients

## File Structure

```text
streaming/
  sse-registry.ts   # SseRegistry class — register, emit, bind, cleanup (~200 lines)
```
