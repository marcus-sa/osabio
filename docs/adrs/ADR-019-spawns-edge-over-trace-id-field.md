# ADR-019: Spawns Relation Edge Over trace_id Field on Message

## Status

Proposed

## Context

When migrating subagent traces from embedded arrays on `message` records to the normalized `trace` table, we need a way to link messages to their root trace records. Two approaches:

1. **`spawns` relation edge** (`RELATE message ->spawns-> trace`) — a graph edge table
2. **`trace_id` field on message** (`DEFINE FIELD trace_id ON message TYPE option<record<trace>>`) — a direct record link

## Decision

Use a `spawns` TYPE RELATION table.

## Rationale

### For spawns edge:
- **Graph-native**: Enables idiomatic SurrealDB traversal in both directions (`->spawns->trace` and `<-spawns<-message`)
- **No message schema change**: The message table already has many fields; adding trace_id creates coupling
- **Multiple traces per message**: A message can spawn multiple subagent traces (e.g., PM agent + analytics agent). A single `trace_id` field would need to become `trace_ids: array<record<trace>>`, while multiple edges handle this naturally
- **Extensible**: Edge can carry metadata (spawn order, spawn reason) without further message schema changes
- **Consistent with codebase**: Other relations (observes, belongs_to, member_of) use TYPE RELATION tables

### Against trace_id field:
- Simpler queries (`SELECT trace_id FROM message` vs graph traversal)
- Slightly less overhead (no edge table)

### Why edge wins:
The multiple-traces-per-message case (Example 4 in US-TM02) makes a single field insufficient. The project already uses relation tables extensively. The query overhead is negligible for the read patterns involved.

## Consequences

- New `spawns` table in schema (TYPE RELATION IN message OUT trace)
- Write path uses `RELATE` (not field assignment)
- Read path uses graph traversal (not field access)
- Batch loading requires `INSIDE` operator on reverse traversal
