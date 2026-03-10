# ADR-020: Batch Trace Loading with Two-Query Pattern

## Status

Proposed

## Context

Conversation load endpoints return messages with their subagent traces. A naive implementation would query traces per-message (N+1 pattern). With conversations of 50+ messages, this creates significant database overhead.

## Decision

Load all traces for a conversation's messages in exactly 2 queries:
1. All root traces linked via spawns edges to the message batch
2. All child traces whose parent_trace is in the root set

## Rationale

### Alternatives considered:

**A. Per-message query** (N+1):
- Simple but O(N) queries per conversation load
- Unacceptable for conversations with many messages

**B. Single query with FETCH**:
- `SELECT *, ->spawns->trace.* FROM message` with recursive FETCH
- SurrealDB FETCH resolves references but doesn't support recursive child loading
- Would still need a second query for children

**C. Two-query batch** (chosen):
- Query 1: All roots for message batch using `INSIDE` operator
- Query 2: All children for root batch using `INSIDE` operator
- O(2) queries regardless of conversation size
- Simple to implement, easy to reason about

**D. Denormalized cache field**:
- Store trace summary on message for fast reads
- Violates the purpose of the migration (removing denormalized data)

## Consequences

- Trace batch loader function accepts `RecordId[]` and returns `Map<string, SubagentTrace[]>`
- Both workspace-routes and branch-chain use the same loader
- Maximum 2 additional queries per conversation load (previously 0 extra queries, but embedded data was free)
- Acceptable tradeoff: 2 queries vs graph-native queryability
