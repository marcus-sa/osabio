# 04 - React Router Chat UI

## Objective
Build the frontend chat flow with TanStack Router and SSE rendering.

## Deliverables
- Root route shell and chat route in TanStack Router.
- Reachat-integrated chat surface (`Chat`, `SessionMessages`, `ChatInput`).
- Streaming token updates and extracted entity badges.
- Mention search (`@`) wired to `/api/entities/search`.

## Acceptance Criteria
- Send message -> response stream appears incrementally.
- Final assistant response and entity badges render without reload.
