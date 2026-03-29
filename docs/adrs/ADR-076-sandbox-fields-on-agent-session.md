# ADR-076: Sandbox Fields on agent_session (Not a Separate Table)

## Status

Proposed

## Context

SandboxAgent integration requires tracking sandbox-specific state: provider type, replay configuration, event sequence numbers, and session type discriminator. The question is whether this state belongs on the existing `agent_session` table or a new `sandbox_session` table.

## Decision

Add sandbox-specific fields directly to `agent_session`. No separate table.

## Rationale

Analysis of the existing `agent_session` schema shows most SandboxAgent concepts already map to existing fields:

- `external_session_id` = sandbox runtime session ID
- `agent` = agent type ("claude", "codex")
- `orchestrator_status` = session lifecycle status
- `worktree_path` = working directory
- `worktree_branch` = git branch for local provider
- `ended_at` = session destruction time
- `last_event_at` = last activity timestamp

Only 5 new fields are needed: `provider`, `session_type`, `replay_max_events`, `replay_max_chars`, `last_event_seq`. All are optional — Osabio-native agent sessions simply don't set them.

A separate table would have required joins on every session operation, transaction coordination on creation, and a second table to maintain — all for fields that naturally belong on the session record.

## Alternatives Considered

### Separate sandbox_session table with record<agent_session> reference

- **Pro**: Schema separation between agent types
- **Con**: Joins on every session query. Two records to create per session. 10+ fields that duplicate what `agent_session` already has (workspace, status, cwd, timestamps).
- **Rejected**: Over-engineering. The "schema pollution" argument doesn't hold — 5 optional fields on a SCHEMAFULL table have no storage cost when unset, and the project doesn't maintain backwards compatibility with existing data.

## Consequences

### Positive

- Single-table queries for all session operations
- No join overhead on the hot path
- Reuse of existing fields, indexes, and relations
- Simpler session creation (one record, not two in a transaction)

### Negative

- `agent_session` gains 5 optional fields unused by Osabio-native agents
- Session type branching in queries (`WHERE session_type = "sandbox_agent"`)
