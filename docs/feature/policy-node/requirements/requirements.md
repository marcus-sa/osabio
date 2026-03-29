# Policy Node — Requirements

## Feature Summary

Replace the in-memory `WorkspacePolicy` stub in `authorizer.ts` with a persistent, graph-backed policy node in SurrealDB. Policies are SCHEMAFULL records with structured rules, connected to identities and workspaces via graph edges. The authorizer traverses the policy graph at intent evaluation time to deterministically permit or deny actions before the LLM tier runs.

## Functional Requirements

### FR-1: Policy Schema (Table + Fields)

- `policy` table is SCHEMAFULL with fields: `title`, `description`, `version`, `status`, `selector`, `rules[]`, `human_veto_required`, `max_ttl`, `created_by`, `created_at`, `updated_at`
- `status` ASSERT IN `['active', 'draft', 'deprecated', 'testing', 'superseded']`
- `rules` is `array<object>` with `rules[*].id`, `rules[*].condition`, `rules[*].effect` (ASSERT `allow` | `deny`), `rules[*].priority`
- `selector` is `object` with optional fields: `selector.workspace`, `selector.agent_role`, `selector.resource`

### FR-1a: Rule Condition Format (Structured JSON Predicates)

Rule conditions are **structured JSON predicates**, not arbitrary strings. This avoids `eval()` and provides a safe, typed evaluation path.

**Predicate structure:**
```typescript
type RulePredicate = {
  field: string;                          // dot-path into the intent evaluation context
  operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "exists";
  value: string | number | boolean | string[];  // comparison target
};

// A condition is one or more predicates (AND-joined)
type RuleCondition = RulePredicate | RulePredicate[];  // single predicate or AND-array
```

**Examples:**
```json
// Budget cap: intent budget <= 500
{ "field": "budget_limit.amount", "operator": "lte", "value": 500 }

// Action blocklist: deny deploy actions
{ "field": "action_spec.action", "operator": "eq", "value": "deploy" }

// Resource scope: only applies to banking_api
{ "field": "authorization_details.0.resource", "operator": "eq", "value": "banking_api" }

// Combined (AND): budget under 500 AND action is "pay"
[
  { "field": "budget_limit.amount", "operator": "lte", "value": 500 },
  { "field": "action_spec.action", "operator": "eq", "value": "pay" }
]
```

**Evaluator:** Pure TypeScript function that traverses the intent context object matching field dot-paths against predicate operators. No `eval()`, no dynamic code execution.

### FR-1b: Intent Fields Available at Policy Evaluation Time

The rule evaluator receives the following intent fields as the evaluation context. Rule conditions can reference any of these via dot-path:

| Field Path | Type | Source | Example |
|------------|------|--------|---------|
| `goal` | `string` | intent.goal | `"Pay invoice #123"` |
| `reasoning` | `string` | intent.reasoning | `"Vendor payment due today"` |
| `priority` | `number` (0-100) | intent.priority | `50` |
| `action_spec.provider` | `string` | intent.action_spec.provider | `"brain"` |
| `action_spec.action` | `string` | intent.action_spec.action | `"pay"` |
| `action_spec.params.*` | `unknown` | intent.action_spec.params | `{ "resource": "stripe" }` |
| `budget_limit.amount` | `number` | intent.budget_limit.amount | `200` |
| `budget_limit.currency` | `string` | intent.budget_limit.currency | `"USD"` |
| `authorization_details[N].type` | `string` | Always `"osabio_action"` | `"osabio_action"` |
| `authorization_details[N].action` | `string` | OsabioAction.action | `"pay"` |
| `authorization_details[N].resource` | `string` | OsabioAction.resource | `"stripe"` |
| `requester_type` | `string` | identity.type | `"agent"` |
| `requester_role` | `string` | identity.role | `"code_agent"` |

**Note:** `budget_limit` and `action_spec.params` are optional on intent. The predicate evaluator treats missing fields as non-matching (a predicate on a missing field returns `false`, which means deny rules on missing fields do not trigger).

### FR-2: Graph Relations

- `governing` — `TYPE RELATION IN identity OUT policy SCHEMAFULL`
- `protects` — `TYPE RELATION IN policy OUT workspace SCHEMAFULL`
- Both include `created_at` field

### FR-3: Policy Gate Graph Traversal

- Replace `checkPolicyGate(intent, policy)` with graph traversal:
  1. Load identity-linked policies: `SELECT ->governing->policy FROM $identity WHERE status = 'active'`
  2. Load workspace-linked policies: `SELECT <-protects<-policy FROM $workspace WHERE status = 'active'`
  3. Deduplicate by policy ID
  4. Merge all rules, sort by priority DESC
  5. First matching deny rule → REJECT (short-circuit)
  6. If any policy has `human_veto_required = true` → force `veto_window` route
  7. All allow rules pass → continue to LLM tier

### FR-4: Policy Evaluation Trace

- Persist `policy_trace` on `intent.evaluation` — array of `{ policy_id, policy_version, rule_id, effect, matched, priority }`
- Trace is available to the reviewer in the veto view
- Trace is queryable by auditor for compliance reporting

### FR-5: Policy Lifecycle

- Draft → Testing → Active → Deprecated (forward-only, no back-transitions)
- Active → Superseded (when a new version is created)
- Version is immutable once created; updates create new versions
- Deprecation removes `governing` and `protects` edges

### FR-6: Audit Integration

- Extend `audit_event.event_type` ASSERT to include: `policy_created`, `policy_activated`, `policy_updated`, `policy_deprecated`
- `audit_event.payload` includes policy ID and version for policy-related events
- Intent evaluation audit events include `policy_trace` in payload

### FR-7: Backward Compatibility (Empty Policy Set)

- When no active policies exist for an identity+workspace, the policy gate passes (empty set = pass)
- This preserves current behavior where `policy: {}` always passes `checkPolicyGate()`

### FR-8: Policy Authorization Model

- Policy CRUD operations (create, update, deprecate) are restricted to identities with `type: "human"` that are `member_of` the target workspace
- Agent identities (`type: "agent"`) can read policies and policy traces but cannot create, update, or deprecate policies
- Policy activation (draft → active) requires the activating identity to be the `created_by` identity or a workspace owner
- This is enforced at the application layer (route handlers), not via SurrealDB table permissions (those require record-level auth which is out of scope)

## Non-Functional Requirements

### NFR-1: Latency

- Policy graph traversal must complete within 50ms for typical workloads (≤10 policies per workspace)
- Use SurrealDB indexes on `policy.status` and relation edges

### NFR-2: Consistency

- Policy activation and edge creation must be atomic (single transaction)
- Policy evaluation must use a consistent snapshot (no torn reads during rule evaluation)

### NFR-3: Auditability

- Every policy state transition produces an audit_event
- Policy versions are immutable — no retroactive modification of rules

### NFR-4: Scalability

- The system supports up to 100 policies per workspace and 10,000 policies across all workspaces
- Policy loading latency remains <100ms at 100 policies per workspace
- Index on `policy.status` and `governing`/`protects` relation edges ensures graph traversal scales

### NFR-5: Concurrency

- Concurrent policy updates use optimistic concurrency: the version field acts as a generation counter
- If two admins update the same policy simultaneously, the second update creates version N+1 from the latest committed version, not from the stale version — last-write-wins with version sequencing
- No lost updates: each version is a new immutable record (not an in-place mutation)

## Out of Scope (This Phase)

- Policy CRUD API endpoints (will be added when UI is built)
- Policy conflict detection at activation time (future: create observation on conflict)
- Policy dry-run/testing mode
- Policy templates or inheritance
- MCP tool for agents to query applicable policies before submitting intents
