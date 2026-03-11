# Observer Agent — Requirements

## R1: Event-Triggered Observation Pipeline

The system MUST fire SurrealDB ASYNC EVENTs when task or intent status transitions to terminal states, delivering the full record to an Observer endpoint.

**Traces to:** Job 1 (Reality Verification)

### Sub-requirements

- R1.1: `DEFINE EVENT task_completed ON task ASYNC RETRY 3` fires when `$after.status IN ["completed", "done"] AND $before.status NOT IN ["completed", "done"]`
- R1.2: `DEFINE EVENT intent_completed ON intent ASYNC RETRY 3` fires when `$after.status IN ["completed", "failed"] AND $before.status NOT IN ["completed", "failed"]`
- R1.3: EVENT webhook POSTs to `POST /api/observe/:table/:id` with the full `$after` record
- R1.4: Observer endpoint is idempotent — duplicate EVENT deliveries produce at most one observation per (entity, transition) pair

## R2: External Signal Gathering

The Observer Agent MUST query external sources to gather reality signals for the entity being verified.

**Traces to:** Job 1 (Reality Verification)

### Sub-requirements

- R2.1: For tasks linked to a `source_commit` or PR, query GitHub CI status
- R2.2: For intents with `action_spec`, verify the action outcome matches the claimed status
- R2.3: External API failures MUST NOT block the entity's status transition — fail open
- R2.4: Each signal source is recorded in the observation's `source` field

## R3: Claim vs Reality Comparison

The Observer Agent MUST compare the claimed state transition against gathered external signals and produce a verdict.

**Traces to:** Job 1 (Reality Verification)

### Sub-requirements

- R3.1: Verdict is one of: `match`, `mismatch`, `inconclusive`
- R3.2: `match` → observation with `severity: info`, `verified: true`
- R3.3: `mismatch` → observation with `severity: conflict`, `verified: false`
- R3.4: `inconclusive` (no signals available) → observation with `severity: info`, note missing source
- R3.5: Every observation MUST be linked to the triggering entity via an `observes` edge

## R4: Schema Extensions

The observation table MUST be extended to support verification metadata.

**Traces to:** Job 1, Job 2

### Sub-requirements

- R4.1: Add `verified: bool DEFAULT false` field to `observation` table
- R4.2: Add `source: option<string>` field for external signal attribution
- R4.3: Add `data: option<object>` field for raw metrics/evidence
- R4.4: Extend `observation_type` enum with `validation` and `error`
- R4.5: Extend `observes` OUT types to include `intent`

## R5: Observer Agent Implementation

A dedicated Observer Agent MUST exist as a Vercel AI SDK tool-loop agent, similar to the PM Agent pattern.

**Traces to:** Job 1, Job 2

### Sub-requirements

- R5.1: Observer Agent uses `ToolLoopAgent` pattern from `agents/pm/`
- R5.2: Observer Agent has tools: `create_observation`, `get_entity_detail`, `search_entities`
- R5.3: Observer Agent system prompt includes workspace context and open observations
- R5.4: Observer Agent runs on a cost-efficient model (Haiku-class)
- R5.5: Observer Agent has `observer` authority scope (already defined: `create_observation`, `create_intent`, `submit_intent`)

## R6: Periodic Graph Scan (Cross-Agent Peer Review)

The Observer Agent MUST support a periodic scan mode that detects contradictions, stale blockers, and drift across the graph.

**Traces to:** Job 2 (Cross-Agent Peer Review)

### Sub-requirements

- R6.1: Scan detects contradictions between confirmed decisions and completed tasks
- R6.2: Scan detects tasks blocked longer than a configurable threshold
- R6.3: Scan detects status drift (e.g., task marked complete but dependent tasks still blocked)
- R6.4: Scan results produce observations with appropriate severity and type
- R6.5: Scan is triggered via a dedicated endpoint `POST /api/observe/scan/:workspaceId`

## Non-Requirements (Deferred)

- Evidence-to-Learning pipeline (deferred until Learning Agent is built)
- `pending_verification` task status (v1 creates observations but does not block status transitions)
- UI for configuring verification sources per workspace (v1 uses workspace integrations if present)
