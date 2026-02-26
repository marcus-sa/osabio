# 02 - Bun API Chat and SSE

## Objective
Implement chat request handling and SSE streaming with deterministic event flow.

## Deliverables
- `POST /api/chat/messages` validates body and starts async message processing.
- `GET /api/chat/stream/:messageId` streams JSON SSE events.
- Event order: token(s) -> extraction -> assistant_message -> done.
- Processing failures emit `error` SSE event.

## Acceptance Criteria
- Invalid request returns `400`.
- Unknown stream id returns `404`.
- Stream closes after `done` or `error`.
