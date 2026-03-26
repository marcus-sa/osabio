# Wave Decisions: Evidence-Backed Intent Authorization

## Decision Log

### WD-01: Evidence Pipeline Placement -- After Policy Gate, Before LLM

**Decision**: The evidence verification pipeline runs after the policy gate and before the LLM evaluator in the `evaluateIntent` function.

**Rationale**: The policy gate is the cheapest check (~5ms). If policy rejects, evidence verification is wasted work. Evidence verification (~10-30ms) is an order of magnitude cheaper than LLM evaluation (~2-5s), so hard enforcement can reject before the expensive call. The LLM evaluator benefits from evidence context, so verification must complete before it runs.

**Alternatives considered**:
- Before policy gate: Wastes 10-30ms on intents that policy will reject anyway
- After LLM evaluator: Hard enforcement cannot reject pre-LLM; LLM lacks evidence context
- Parallel with LLM: Adds complexity; hard enforcement needs sequential result

### WD-02: Single Batched SurrealDB Query for All Refs

**Decision**: All evidence refs (max 10) are resolved in a single SurrealDB query using RecordId batch selection.

**Rationale**: Single round-trip ensures sub-100ms p95 latency target. SurrealDB supports `SELECT ... FROM $refs` where `$refs` is an array of RecordIds, resolving all records in one operation.

**Alternatives considered**:
- Sequential per-ref queries: O(N) round-trips; 10 refs at ~5ms each = 50ms minimum, risk of p95 breach
- Parallel per-ref queries: Risk of SurrealDB WebSocket concurrency issues (documented in project conventions)
- Pre-cached entity lookup: Adds cache invalidation complexity; workspace scope changes would be stale

### WD-03: Pure Function Pipeline with Single Effect Boundary

**Decision**: The evidence verification pipeline follows the same architectural pattern as `evaluatePolicyGate` -- pure functions composed around a single DB read (effect boundary).

**Rationale**: This pattern is already established in the codebase (policy gate). It maximizes testability: all verification logic is unit-testable with mock data. The single effect boundary (batch query) is the only integration test needed.

**Alternatives considered**:
- Effectful per-check functions (each check queries DB separately): Multiple effect boundaries; harder to test; multiple round-trips
- Middleware pattern: Doesn't match the functional paradigm of this codebase

### WD-04: Enforcement Mode as Workspace-Level Data, Not Feature Flag

**Decision**: Evidence enforcement mode (`bootstrap | soft | hard`) is stored on the `workspace` table as a configurable field, not as a global feature flag or hardcoded mode.

**Rationale**: Consistent with project's "no hardcoded modes" principle. Each workspace progresses independently through enforcement stages based on its maturity. Admin can override. The auto-transition logic evaluates maturity thresholds lazily at intent evaluation time.

**Alternatives considered**:
- Global feature flag: All workspaces would be forced to the same mode; no per-workspace graduation
- Config file: Requires server restart to change; no per-workspace control
- Policy rule: Overcomplicates what is fundamentally a workspace lifecycle setting

### WD-05: Extend Existing observer/evidence-validator.ts Pattern

**Decision**: The new evidence verification pipeline reuses the table allowlist and ref parsing pattern from `observer/evidence-validator.ts`, but implements a separate module (`intent/evidence-verification.ts`) with the full verification pipeline.

**Rationale**: The observer's evidence validator is a simple filter (ref -> exists in set). The intent pipeline needs existence + scope + temporal + liveness + authorship + age + tier -- a fundamentally different problem requiring batch DB queries. Forcing these into the observer module would violate its single responsibility. However, the table allowlist and parsing logic are reused.

### WD-06: Risk Score Penalty Over Binary Reject for Soft Enforcement

**Decision**: Under soft enforcement, evidence shortfall adds +20 risk score per missing ref (below tier requirement), rather than binary pass/fail.

**Rationale**: Graduated penalty provides a smooth signal that feeds into the existing risk routing logic. An intent with 2/3 required refs gets +20 (one missing); an intent with 0/3 gets +60. This naturally routes under-evidenced intents to the veto window without hard-blocking legitimate intents during the adoption period.

**Calibration note**: The +20 default is a starting value to be calibrated during the soft enforcement adoption period. Track actual routing impact using the `evidence.shortfall_penalty_total` span attribute. Adjust based on observed false rejection rate (KPI-5 target: < 2%). If > 2% of legitimate intents are rejected due to evidence shortfall penalty pushing them above the reject threshold, reduce the penalty.

**Alternatives considered**:
- Binary pass/fail: No graduated signal; forces all under-evidenced intents into the same bucket
- Multiplicative score: Harder to reason about; interaction effects with LLM risk score unpredictable
- Separate evidence score alongside risk score: Requires routing logic changes throughout; existing risk_score is the established routing signal

### WD-07: Evidence Context in LLM Evaluator Prompt, Not Tool

**Decision**: Evidence verification results are appended to the LLM evaluator prompt as structured context, not provided as a tool the LLM can call.

**Rationale**: The LLM evaluator runs `generateObject` with a fixed prompt -- it does not use tools. Evidence context is factual input (like the intent's goal and action_spec), not something the LLM needs to discover interactively. Adding it to the prompt is the simplest integration.

**Alternatives considered**:
- LLM tool call: Evaluator does not use tools; would require architectural change to evaluator
- Separate LLM call for evidence assessment: Doubles LLM cost; evidence assessment is deterministic, not semantic

### WD-09: MCP Tool Description as Agent Guidance Contract

**Decision**: The `CREATE_INTENT_TOOL` description in `brain-tool-definitions.ts` must be updated to explain evidence_refs — what they are, which entity types are valid, and how evidence quality affects authorization routing. The `get_context` tool response must include the workspace's current `evidence_enforcement` mode.

**Rationale**: The MCP tool description is the **only guidance agents receive** about evidence submission. Without updated descriptions, agents will never provide evidence_refs, making the entire evidence verification pipeline dead code. This is not documentation — it is a critical integration point. The `get_context` enforcement mode enables agents to adapt their behavior (gather evidence proactively under hard enforcement, optionally under soft enforcement).

**Alternatives considered**:
- Rely on agent system prompts: Agents may use any MCP client; system prompts are not controlled by Brain
- Add a separate `get_evidence_requirements` tool: Over-engineering; enforcement mode is already delivered via proxy session context
- Make evidence_refs required in the schema: Would break all existing agents immediately; graduated enforcement handles this

### WD-08: Lazy Maturity Evaluation for Bootstrap Transition

**Decision**: The bootstrap -> soft -> hard enforcement transitions are evaluated lazily at intent evaluation time, not via background jobs or SurrealDB events.

**Rationale**: Transitions are infrequent (once per workspace lifecycle stage). A background job would add operational complexity for a check that runs at most twice per workspace lifetime. Evaluating at intent time means the workspace transitions at the natural moment -- when an intent is being authorized.

**Alternatives considered**:
- Background cron/scheduler: Adds operational complexity; transitions may happen when no intents are being processed
- SurrealDB EVENT on decision/task creation: Complex trigger chain; race conditions with concurrent writes
- Admin-only manual transition: Burdensome for admin; defeats the purpose of automatic graduation
