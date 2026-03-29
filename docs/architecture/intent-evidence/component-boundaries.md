# Component Boundaries: Evidence-Backed Intent Authorization

## Component Map

### New Components

| Component | Location | Responsibility | Dependencies (inward) | Consumers |
|-----------|----------|---------------|----------------------|-----------|
| Evidence Verification Pipeline | `app/src/server/intent/evidence-verification.ts` | Pure pipeline: parse refs, batch query, check existence/scope/temporal/liveness/authorship/age/tier | SurrealDB (via injected Surreal instance) | `evaluateIntent` in authorizer.ts |
| Evidence Constants | `app/src/server/intent/evidence-constants.ts` | Valid status map, tier requirements, penalty defaults, table allowlist, minimum age | None (pure constants) | Evidence pipeline, risk router |
| Evidence Types | `app/src/server/intent/evidence-types.ts` | Type definitions for EvidenceVerificationResult, EvidenceRef, RiskTierRequirements, EvidenceEnforcementMode | None (pure types) | Evidence pipeline, risk router, feed queries, intent types |

### Modified Components

| Component | Location | Change | Scope of Change |
|-----------|----------|--------|----------------|
| Intent Evaluation | `app/src/server/intent/authorizer.ts` | Call evidence pipeline between policy gate and LLM evaluator; pass result to risk router and LLM prompt | Single integration point in `evaluateIntent` function |
| Intent Evaluation Orchestrator | `app/src/server/intent/intent-evaluation.ts` | Thread evidence_refs from intent record to evaluateIntent; thread enforcement mode from workspace | Pass-through wiring |
| Risk Router | `app/src/server/intent/risk-router.ts` | Accept evidence verification result; apply shortfall penalty to risk score | New optional parameter + penalty logic |
| Intent Queries | `app/src/server/intent/intent-queries.ts` | Write evidence_verification to intent record alongside evaluation | Extend StatusUpdateFields type |
| Intent Types | `app/src/server/intent/types.ts` | Add evidence_refs and evidence_verification to IntentRecord | Type extension |
| Intent Routes | `app/src/server/intent/intent-routes.ts` | Accept evidence_refs in intent creation payload | Input parsing extension |
| MCP Tool Definitions | `app/src/server/mcp/osabio-tool-definitions.ts` | Add `evidence_refs` parameter to `createIntentSchema`; update `CREATE_INTENT_TOOL` description to guide agents on evidence submission | Schema + description change |
| MCP Create Intent Handler | `app/src/server/mcp/create-intent-handler.ts` | Add `evidence_refs` to `CreateIntentInput` type and `validateInput`; pass through to `createIntent` query | Type extension + validation + pass-through |
| Feed Queries | `app/src/server/feed/feed-queries.ts` | Include evidence_verification in pending intent feed items | Query extension + new feed card data |
| Workspace Routes | `app/src/server/workspace/workspace-routes.ts` | Read/write evidence_enforcement and evidence_enforcement_threshold | New settings endpoint |
| Observer Graph Scan | `app/src/server/observer/graph-scan.ts` | Add evidence anomaly detection scan pattern | New scan function |
| Policy Gate | `app/src/server/policy/policy-gate.ts` | Support evidence_requirement rule type in policy evaluation | New predicate type |
| Proxy Context XML | `app/src/server/proxy/context-injector.ts` (`buildOsabioContextXml`) | Add a `<workspace-settings>` section to the `<osabio-context>` XML block that includes `evidence_enforcement` mode | Minor: new XML section in `buildOsabioContextXml` output |
| Proxy Context Cache | `app/src/server/proxy/context-cache.ts` | Include workspace `evidence_enforcement` in the cached context data fetched for proxy injection | Query extension to include workspace settings |
| LLM Evaluator | `app/src/server/intent/authorizer.ts` | Append evidence verification summary to evaluator prompt in `createLlmEvaluator` | Prompt template extension |
| Shared Contracts | `app/src/shared/contracts.ts` | Add evidence fields to `GovernanceFeedItem` type for client feed display | Shared type extension (server + client) |
| SurrealDB Schema | `schema/surreal-schema.surql` + migration | Add intent.evidence_refs, intent.evidence_verification, workspace.evidence_enforcement fields; add "evidence_anomaly" to observation_type ASSERT (Release 3) | Schema migration |

## MCP Tool Integration

The `create_intent` MCP tool is the primary surface through which agents submit evidence. Three files form the MCP integration chain:

### 1. Tool Definition (`osabio-tool-definitions.ts`)

`createIntentSchema` gains an optional `evidence_refs` parameter — an array of entity ID strings in `table:id` format (e.g. `["decision:abc123", "task:def456"]`). The `CREATE_INTENT_TOOL` description must be updated to:
- Explain that evidence_refs are graph record references that justify the intent
- State that evidence quality affects authorization routing (insufficient evidence elevates risk score)
- Note which entity types are valid evidence (decision, task, observation, feature, project, policy, objective, learning, git_commit)
- Clarify that evidence_refs are optional during soft enforcement but required during hard enforcement

This is critical because the tool description is the **only guidance agents receive** about evidence submission. Without clear description, agents will not provide evidence_refs even when the workspace expects them.

### 2. Handler Input (`create-intent-handler.ts`)

`CreateIntentInput` type adds `evidence_refs?: string[]`. The `validateInput` function parses each ref as `table:id`, validates the table against the allowlist (same tables as the schema union type), and converts to `RecordId[]` at the HTTP boundary per project convention.

### 3. Query Pass-through (`intent-queries.ts`)

`CreateIntentParams` adds `evidence_refs?: RecordId[]`. The `createIntent` function includes `evidence_refs` in the `CREATE` content when present.

### Context Delivery (proxy `<osabio-context>` block)

The proxy injects a `<osabio-context>` XML block into the agent's system prompt (built by `buildOsabioContextXml()` in `context-injector.ts`, orchestrated by `anthropic-proxy-route.ts`). Currently this block contains `<decisions>`, `<learnings>`, and `<observations>` sections.

A new `<workspace-settings>` section includes the workspace's `evidence_enforcement` mode so agents know whether evidence is required, encouraged, or exempt. The context cache (`context-cache.ts`) fetches workspace enforcement mode alongside existing context candidates.

Example XML output:
```xml
<osabio-context>
  <workspace-settings>
    <evidence-enforcement>soft</evidence-enforcement>
  </workspace-settings>
  <decisions>...</decisions>
  <learnings>...</learnings>
  <observations>...</observations>
</osabio-context>
```

No new tool needed — this extends the existing proxy context payload.

## Component Interaction Diagram

```
Intent Creation (agent submits evidence_refs via MCP create_intent tool)
  |
  v
MCP Create Intent Handler (validates evidence_refs, converts to RecordId[])
  |
  v
Intent Routes (validates evidence_refs format)
  |
  v
Intent Queries (creates intent with evidence_refs in DB)
  |
  v  [SurrealDB EVENT: draft -> pending_auth]
  |
Intent Evaluation (orchestrator)
  |
  +---> Policy Gate (existing: ~5ms)
  |       |
  |       v  [if policy rejects, STOP]
  |
  +---> Evidence Verification Pipeline (new: ~10-30ms)
  |       |
  |       +---> Read workspace.evidence_enforcement
  |       +---> Parse evidence_refs
  |       +---> Batch query SurrealDB (all refs in one round-trip)
  |       +---> Check: existence, workspace scope, temporal, liveness
  |       +---> Check: authorship independence (Release 2)
  |       +---> Check: minimum age (Release 2)
  |       +---> Evaluate tier requirements (Release 2)
  |       +---> Build EvidenceVerificationResult
  |       |
  |       v  [if hard enforcement AND insufficient, REJECT pre-LLM]
  |
  +---> LLM Evaluator (existing: ~2-5s, now with evidence context)
  |
  +---> Risk Router (existing: applies evidence shortfall penalty)
  |
  v
Intent Status Update (writes evaluation + evidence_verification to DB)
  |
  v
Governance Feed (displays evidence chain to workspace admin)
```

## Boundary Rules

### Evidence Verification Pipeline (core purity boundary)

The evidence verification pipeline is a **pure function pipeline** with a single effect boundary (the batch SurrealDB query). This is the critical architectural constraint.

**Allowed imports**:
- `surrealdb` SDK types (RecordId, Surreal) -- for the effect boundary
- `evidence-constants.ts` -- pure constants
- `evidence-types.ts` -- pure types

**Forbidden imports**:
- `ai` (Vercel AI SDK) -- verification is deterministic, not LLM-based
- Any HTTP/routing module -- verification is invoked by the evaluator, not by routes
- Any module-level mutable state -- pipeline is stateless

### Risk Router (extended boundary)

The risk router already receives `EvaluationResult` and returns `RoutingDecision`. The extension adds an optional `EvidenceVerificationResult` parameter. The router applies the penalty calculation as a pure function.

**New parameter**: `evidenceVerification?: EvidenceVerificationResult`
**Penalty rule**: `+20 risk score per missing ref below tier requirement` (configurable)

### Workspace Enforcement Config (data-driven boundary)

Enforcement mode (`bootstrap | soft | hard`) is stored on the workspace record and read at evaluation time. This is NOT a hardcoded processing mode -- it is workspace-configurable data that drives pipeline behavior, consistent with the project's "no hardcoded modes" principle.

The enforcement mode is read once per evaluation and passed as a parameter to the evidence pipeline. The pipeline never reads it from the database directly.

## Reuse Analysis

### Existing code reused

| Existing Component | How Reused |
|-------------------|------------|
| `observer/evidence-validator.ts` (parseEntityRef, VALID_TABLES) | Reference parser pattern reused. Extend VALID_TABLES set to include `policy`, `objective`, `learning`. |
| `policy/policy-gate.ts` (evaluatePolicyGate pipeline) | Architectural pattern reused: pure pipeline with single effect boundary. Evidence pipeline follows the same compose-pure-functions pattern. |
| `intent/risk-router.ts` (routeByRisk) | Extended with optional evidence parameter. Same function signature pattern. |
| `policy/predicate-evaluator.ts` (evaluateCondition) | Reused for policy-defined evidence rules (Release 3). |
| `feed/feed-queries.ts` (mapPendingIntentToFeedItem) | Extended to include evidence data in feed items. |
| `observer/graph-scan.ts` | Extended with new scan pattern for evidence anomaly detection. |

### New code justified

| New Module | Why Not Reusable From Existing |
|-----------|-------------------------------|
| `evidence-verification.ts` | No existing batch-verification pipeline. The observer's `evidence-validator.ts` is a simple filter (refs against a set); the intent pipeline needs existence + scope + temporal + liveness + authorship checks in a single batched query. Different problem. |
| `evidence-constants.ts` | Domain-specific constants (valid statuses per entity type, tier requirements) have no existing equivalent. |
| `evidence-types.ts` | New types for the verification result contract. No existing type covers this shape. |
