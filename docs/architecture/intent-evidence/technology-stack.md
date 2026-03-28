# Technology Stack: Evidence-Backed Intent Authorization

## Overview

This feature introduces no new technology dependencies. It extends the existing stack with new modules and schema changes.

## Stack Decisions

| Layer | Technology | Version | License | Rationale | Alternatives Considered |
|-------|-----------|---------|---------|-----------|------------------------|
| Runtime | Bun | >=1.3 | MIT | Existing runtime. Evidence pipeline runs as pure TypeScript functions within the same process. | N/A (extending existing system) |
| Database | SurrealDB | v3.0 | BSL 1.1 | Existing graph database. Evidence refs are `record<...>` types with native referential integrity. Batch query in single round-trip. | N/A (extending existing system) |
| Language | TypeScript | 5.x | Apache 2.0 | Existing language. Pure functions for pipeline, explicit types for all contracts. | N/A (extending existing system) |
| Schema Validation | Zod | 3.x | MIT | Existing validation library. Used for evidence_refs input parsing on intent creation API. | N/A (already in use for intent schema validation) |
| Observability | OpenTelemetry | SDK already integrated | Apache 2.0 | Existing instrumentation. New span attributes for evidence verification metrics. | N/A (extending existing system) |
| LLM Evaluation | Vercel AI SDK | Already integrated | Apache 2.0 | Existing evaluation framework. Evidence context appended to evaluator prompt. | N/A (extending existing system) |

## No New Dependencies Justification

The evidence verification pipeline is a **pure function pipeline** that:
1. Parses evidence refs using string operations and a table allowlist
2. Builds a batched SurrealDB query using the existing Surreal SDK
3. Evaluates results using pure comparison logic
4. Returns a typed result object

None of these steps require external libraries beyond what the project already uses. Adding a new dependency for any of these would be unjustified complexity.

## Schema Additions

### SurrealDB Schema Changes (via migration)

New fields on `intent` table:
- `evidence_refs`: `option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>`
- `evidence_verification`: `option<object>` with nested fields for `verified_count`, `failed_refs`, `verification_time_ms`, `warnings`, `independent_author_count`, `tier_met`, `enforcement_mode`

New fields on `workspace` table:
- `evidence_enforcement`: `option<string>` ASSERT `$value IN ['bootstrap', 'soft', 'hard']` (default: "soft")
- `evidence_enforcement_threshold`: `option<object>` with `min_decisions` and `min_tasks`

### Index Strategy

- No new indexes required for evidence verification. The batch query uses primary key lookups (RecordId) which are O(1).
- The workspace `evidence_enforcement` field is read once per evaluation -- no index needed (single record lookup by workspace RecordId).

## Architectural Enforcement Tooling

| Tool | Purpose | License |
|------|---------|---------|
| dependency-cruiser | Verify evidence pipeline has no imports from LLM/HTTP modules | MIT |

This is an existing recommendation for the codebase, not a new tool addition. The evidence pipeline's purity constraint (no AI SDK imports, no HTTP imports) is the primary rule to enforce.
