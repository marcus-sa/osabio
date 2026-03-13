# Evolution: Agent Learnings

**Date**: 2026-03-13
**Feature**: agent-learnings
**Branch**: marcus-sa/agent-learnings

## Summary

Implemented agent learnings -- behavioral rules injected into agent prompts at runtime. Learnings are workspace-scoped knowledge that accumulates as humans and agents work, making the system progressively smarter. Humans create learnings directly or approve agent-suggested ones. Agents detect patterns (repeated corrections, trace failures, observation clusters) and propose learnings, subject to rate limiting and collision detection against existing learnings, policies, and decisions.

The feature spans three layers: a SCHEMAFULL persistence layer with HNSW vector indexing, a JIT loading and formatting pipeline with token budgeting, and a safety layer with three-source pattern detection and three-layer collision detection.

## Architecture Decisions

| ADR | Title | Summary |
|-----|-------|---------|
| ADR-026 | Word count heuristic for learning token budget | Approximate token budget (~500 words) using word count rather than tokenizer dependency. Constraints always included even when they alone exceed budget. |
| ADR-027 | Dedicated learning table over suggestion extension | Separate SCHEMAFULL `learning` table rather than extending the existing suggestion entity. Learnings have distinct lifecycle, relations, and query patterns. |
| ADR-028 | Three-layer collision detection for learnings | Unified collision algorithm checking learning/policy/decision layers with LLM intent classification for ambiguous similarity ranges. Fail-safe defaults to "contradicts" when LLM unavailable. |
| ADR-029 | Workspace-scoped learnings not project-scoped | Learnings apply workspace-wide because behavioral rules (e.g., "never use null") transcend individual projects. Target agent filtering provides sufficient specificity. |
| ADR-030 | JIT learning injection at session start | Load learnings at prompt assembly time rather than caching or pre-computing. Ensures freshness without cache invalidation complexity. |

## Implementation Phases

### Phase 01: Schema Foundation + Core Domain (steps 01-01 through 01-03)

- **Schema migration** (`0030_learning_table.surql`): SCHEMAFULL `learning` table with full lifecycle fields (text, learning_type, status, source, priority, target_agents, workspace, embedding, audit trail). Relation tables `learning_evidence` (IN learning OUT message/trace/observation/agent_session) and `supersedes` (IN learning OUT learning). HNSW index on embedding, composite index on workspace+status.
- **CRUD queries and types**: Workspace-scoped create, update status, supersede, list active/pending, count recent suggestions by agent. Shared contract types (`LearningSummary`, `LearningType`, `LearningStatus`, `LearningSource`) exported from `shared/contracts.ts`.
- **JIT loader and formatter**: Priority-sorted loading (human > agent source, high > medium > low, newest first) with ~500-word token budget. Constraints always included. Instructions fill remaining budget. Precedents included only with context embedding and similarity > 0.70. Pure formatter groups output under "Workspace Learnings" heading by type.

### Phase 02: Integration + HTTP (steps 02-01 through 02-02)

- **Prompt injection**: Learnings section injected into chat agent, PM agent, observer agent, and MCP context builders. Chat and PM use project description as context embedding for precedent matching. Observer gets constraints and instructions only (no precedents). Learnings positioned before conversation/entity context.
- **HTTP endpoints**: POST creates learning with graceful embedding failure handling (persists with `collisionCheckDeferred` flag). GET lists with status/type/agent filters. Approve action runs collision check before activation. Dismiss action records audit trail. Pending learnings surface as governance feed cards.

### Phase 03: Agent Self-Improvement + Safety (steps 03-01 through 03-02)

- **Pattern detection**: Three detection sources -- conversation corrections (3+ on same topic within 14 days via LLM extraction), trace failures (3+ same-tool failures with similar errors), observation clusters (3+ similar by embedding). Rate limiting gate (max 5 suggestions per agent per 7 days). Dismissed re-suggestion prevention (KNN similarity > 0.85 against dismissed learnings blocks re-proposal).
- **Collision detection**: Three-layer algorithm. Learning layer: similarity > 0.90 = duplicate, 0.75-0.90 = LLM classification. Policy layer: similarity > 0.80 = LLM classification, contradiction = hard block. Decision layer: similarity > 0.80 = LLM classification, contradiction = informational. LLM returns structured `{classification, reasoning}`. Fail-safe: defaults to "contradicts" when LLM unavailable. Retroactive deactivation for deferred collision checks that discover policy conflicts on already-active learnings.

## Test Coverage

Six acceptance test suites in `tests/acceptance/agent-learnings/`:

| Suite | Covers |
|-------|--------|
| milestone-1-schema-and-queries | Schema validation, CRUD operations, workspace scoping |
| milestone-2-jit-loader-and-formatter | Token budgeting, priority sorting, precedent filtering, formatter output |
| milestone-3-prompt-injection | Chat/PM/observer/MCP prompt integration, section positioning |
| milestone-4-http-and-feed | HTTP CRUD, embedding failure handling, approve/dismiss, feed cards |
| milestone-5-pattern-detection | Three detection sources, rate limiting, dismissed re-suggestion prevention |
| milestone-6-collision-detection | Three-layer collision, LLM classification, fail-safe, retroactive deactivation |

All 7 roadmap steps passed TDD (COMMIT/PASS) across 12 commits.

## Files Inventory

### Created

| File | Purpose |
|------|---------|
| `schema/migrations/0030_learning_table.surql` | SCHEMAFULL schema, relations, indexes |
| `app/src/server/learning/queries.ts` | SurrealDB CRUD and listing queries |
| `app/src/server/learning/types.ts` | Server-side learning types |
| `app/src/server/learning/loader.ts` | JIT loading with priority sort and token budget |
| `app/src/server/learning/formatter.ts` | Pure prompt section formatter |
| `app/src/server/learning/detector.ts` | Three-source pattern detection with rate limiting |
| `app/src/server/learning/collision.ts` | Three-layer collision detection with LLM classification |
| `app/src/server/learning/learning-route.ts` | HTTP endpoints for CRUD, approve, dismiss |
| `tests/acceptance/agent-learnings/` | 6 milestone test suites + test kit |

### Modified

| File | Change |
|------|--------|
| `app/src/shared/contracts.ts` | Added LearningSummary, LearningType, LearningStatus, LearningSource; extended EntityKind |
| `app/src/server/chat/context.ts` | Inject learnings into chat agent system prompt |
| `app/src/server/agents/pm/prompt.ts` | Inject learnings into PM agent system prompt |
| `app/src/server/agents/observer/prompt.ts` | Inject learnings into observer system prompt |
| `app/src/server/mcp/intent-context.ts` | Inject learnings into MCP context packets |
| `app/src/server/feed/feed-route.ts` | Pending learnings as governance feed cards |
| `app/src/server/runtime/start-server.ts` | Register learning routes |

## Execution Timeline

- **Start**: 2026-03-13 06:14 UTC (step 01-01 PREPARE)
- **End**: 2026-03-13 07:17 UTC (step 03-02 COMMIT)
- **Duration**: ~63 minutes
- **Commits**: 12 (schema through adversarial review fix)

## Status

IMPLEMENTED -- all 7 steps completed with PASS status. Feature docs archived at `docs/feature/agent-learnings/`.
