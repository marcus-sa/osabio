# Walking Skeleton Design Rationale

## Skeletons Selected

### Skeleton 1: Assign, Observe, Send Follow-Up
**Traces**: US-CS-003 + US-CS-001 + US-CS-002

The most critical E2E path: Marcus assigns a task, the event stream wires up and delivers agent output, and Marcus sends a follow-up prompt. This exercises:
- Session creation (existing) triggering event stream iteration (new)
- Event bridge forwarding to SSE registry (new wiring)
- Prompt endpoint delivering instructions to running agent (new)

**Litmus test**: A stakeholder can confirm "yes, an engineering lead needs to see what the agent is doing and tell it to adjust course."

### Skeleton 2: Review Conversation Log
**Traces**: US-CS-003 + US-CS-004

After the agent completes, Marcus opens the review and sees the full conversation log. This exercises:
- Conversation log persistence during event processing (new)
- Log retrieval endpoint (new)
- Review page integration with log data (new)

**Litmus test**: A stakeholder can confirm "yes, the reviewer needs the agent's reasoning trail to make an informed accept/reject decision."

### Skeleton 3: Agent Error Notification
**Traces**: US-CS-001 + US-CS-003

When the agent encounters an error, the session stops and Marcus is notified through the event stream. This exercises:
- Error event forwarding through event bridge (existing transform, new wiring)
- Session status update on stream error (new)
- Error event delivery to client (new wiring)

**Litmus test**: A stakeholder can confirm "yes, if the agent crashes, the lead needs to know immediately."

## Why These Three

1. **Skeleton 1** proves the interactive supervision loop works end-to-end (the core value proposition).
2. **Skeleton 2** proves the review experience has contextual information (the informed decision value).
3. **Skeleton 3** proves failure visibility (the reliability value).

Together they cover: event stream wiring (US-CS-003), live output (US-CS-001), follow-up prompts (US-CS-002), and contextual review (US-CS-004).

## Implementation Sequence

1. Skeleton 1 (enabled first) -- drives event stream wiring + prompt endpoint
2. Skeleton 3 (enable second) -- drives error handling in event iteration
3. Skeleton 2 (enable third) -- drives conversation log persistence + retrieval
