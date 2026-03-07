# ADR-007: Client-Side Token Accumulation Model

## Status
Accepted

## Context
The `useAgentSession` hook receives individual `agent_token` SSE events (word/fragment granularity). The `AgentSessionOutput` component must render these as streaming text with inline file-change notifications and user prompt markers interleaved at the correct chronological position.

## Decision
Accumulate events into a **structured entry array** in the hook state. Each entry has a discriminated type:

- `{ type: "token", text: string, timestamp: string }` -- agent text fragment
- `{ type: "file_change", file: string, changeType: string, timestamp: string }` -- inline notification
- `{ type: "user_prompt", text: string, timestamp: string }` -- echoed follow-up prompt

The output component renders entries in array order. Adjacent `token` entries are concatenated during render (not in state) for display as continuous text blocks.

A `user_prompt` entry creates a visual break -- the output component resets the current text block and starts a new one after the prompt marker.

## Alternatives Considered

### Alternative 1: String concatenation
- What: Accumulate tokens via `state.output += token` (single string)
- Expected Impact: Solves ~70% (streaming text works)
- Why Insufficient: Cannot interleave file-change notifications or user prompts at the correct position in the stream. Would require separate arrays for file changes and prompts with timestamp-based merging at render time. String concat also prevents efficient React rendering (entire string re-renders on every token).

### Alternative 2: Virtual terminal / ANSI buffer
- What: Treat agent output as terminal emulation with control sequences
- Expected Impact: Solves ~90% (rich terminal experience)
- Why Insufficient: OpenCode events are structured data (typed JSON), not raw terminal output. Terminal emulation adds a complex dependency (xterm.js or similar) for no benefit. The structured event types already provide all the information needed for rendering.

## Consequences
- Positive: Interleaving is trivial -- all event types go into the same ordered array
- Positive: React can efficiently diff (append-only array, keyed by index)
- Positive: Token reset on new prompt is a simple array operation
- Negative: Array grows unbounded during long sessions. Acceptable for sessions of minutes-to-hours; can add a rolling window if needed.
