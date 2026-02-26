# 01 - Core Contracts and Single-App Skeleton

## Objective
Establish one Bun TypeScript app that serves both React frontend and API routes from the same process.

## Deliverables
- App layout:
  - `app/server.ts` for API + Bun HTML import serving
  - `app/src/client` for React + TanStack Router
- API contract typed in server code and shared event payloads.
- Runtime env contract documented (`OPENAI_API_KEY`, SurrealDB connection vars).

## API Contracts
- `POST /api/chat/messages`
  - Request: `{ clientMessageId: string, conversationId?: string, text: string }`
  - Response: `{ messageId: string, conversationId: string, streamUrl: string }`
- `GET /api/chat/stream/:messageId` (SSE)
  - Event payloads: `token | assistant_message | extraction | done | error`
- `GET /api/entities/search?q=<string>&limit=<number>`
- `GET /healthz`

## Acceptance Criteria
- `bun run app/server.ts` starts the single app process.
- Frontend route loads and API routes respond from the same host/port.
- TypeScript typecheck passes.
