# Policy CRUD UI -- Requirements Document

**Feature**: policy-crud-ui (GitHub Issue #130)
**Type**: Cross-cutting (API + UI + Authorization)
**Wave**: DISCUSS -> DESIGN handoff

---

## 1. Business Context

Osabio's policy system was delivered as backend infrastructure in the policy-node feature. The evaluation pipeline, graph relations, and SurrealDB schema are operational. However, there is no HTTP API for policy management and no UI for creating, viewing, or managing policies. Only developers with direct database access can create or modify policies.

This feature closes the gap by exposing policy CRUD through REST endpoints and building a management UI that enables non-developer org admins to govern agent behavior without code deployments.

## 2. Stakeholder Analysis

| Stakeholder | Needs | Priority |
|-------------|-------|----------|
| **Org Admin** (Reiko Tanaka) | Create, activate, version, deprecate policies through web UI | Must Have |
| **Intent Reviewer** (Marcus Oliveira) | See policy evaluation trace when reviewing flagged intents | Should Have |
| **Compliance Auditor** (Ayumi Sato) | Browse version history and compare versions for audit | Should Have |
| **Agent Identities** | Read-only access to policies (for context, not mutation) | Must Have |

## 3. Functional Requirements

### FR-1: Policy List API + UI
- List all policies for a workspace via `GET /api/workspaces/:workspaceId/policies`
- Support status filter query parameter (`?status=active`)
- Return: id, title, status, version, created_by_name, created_at, updated_at
- UI: Table with sortable columns, status filter tabs, empty state

### FR-2: Policy Detail API + UI
- Get single policy via `GET /api/workspaces/:workspaceId/policies/:policyId`
- Return: full PolicyRecord fields + resolved governing/protects edges + version history (supersedes chain)
- UI: Detail page with rules (human-readable), options, graph edges, version timeline, action buttons

### FR-3: Policy Creation API + UI
- Create policy via `POST /api/workspaces/:workspaceId/policies`
- Accept: title, description, selector, rules[], human_veto_required, max_ttl
- Always created as `draft` with `version: 1`
- Validate: title required, at least 1 rule, valid predicate structure
- UI: Form with title, description, selector picker, rule builder, options

### FR-4: Rule Builder UI
- Structured form for building rule predicates
- Field autocomplete from known IntentEvaluationContext fields
- Operator dropdown filtered by field type (numeric fields get gt/lt/gte/lte, string fields get eq/neq/in/not_in)
- Value input type adapts to operator (numeric for gt/lt, text for eq, comma-separated for in)
- Real-time human-readable preview ("Deny when budget_limit.amount > 500")
- Inline validation on blur

### FR-5: Policy Activation API
- Activate via `PATCH /api/workspaces/:workspaceId/policies/:policyId/activate`
- Only draft policies can be activated
- Creates governing (creator -> policy) and protects (policy -> workspace) edges
- Records audit event
- UI: Confirmation dialog showing activation impact

### FR-6: Policy Deprecation API
- Deprecate via `PATCH /api/workspaces/:workspaceId/policies/:policyId/deprecate`
- Only active policies can be deprecated
- Removes governing and protects edges
- Records audit event
- UI: Confirmation dialog with impact warning

### FR-7: Policy Version Creation API
- Create new version via `POST /api/workspaces/:workspaceId/policies/:policyId/versions`
- Copies rules, selector, options from current version as starting point
- New version created as `draft` with incremented version number
- Sets `supersedes` reference to source policy
- When new version is activated, old version transitions to `superseded`
- UI: Pre-populated form allowing rule modification before save

### FR-8: Authorization (Mutation Restriction)
- Human identities with `member_of` workspace edge can create, activate, deprecate, and version policies
- Agent identities can only read (GET endpoints) -- mutations return 403
- Enforced at route handler level before business logic

### FR-9: Policy Trace in Intent Review UI
- Render `intent.evaluation.policy_trace` in the consent/veto review screen
- Collapsed summary by default ("N policies evaluated, M rules matched")
- Expandable detail: policy title + version, rule ID, condition (human-readable), matched (yes/no with actual vs threshold), effect, priority
- "View Policy" navigation link per trace entry
- Note when human_veto_required was the flagging reason

### FR-10: Policy Version History
- Version timeline in policy detail showing all versions in the supersedes chain
- Each entry: version number, status, creation date, optional summary
- "View Diff" action between adjacent versions
- Diff view: added/removed/changed rules, changed options, changed selector

## 4. Non-Functional Requirements

### NFR-1: Performance
- Policy list loads in under 500ms for up to 100 policies
- Policy detail (including version chain traversal) loads in under 1s
- Rule builder validation feedback within 100ms of blur

### NFR-2: Security
- All endpoints require authenticated session (existing Better Auth middleware)
- Agent vs human identity check at route handler level
- No raw SurrealDB error messages exposed to clients

### NFR-3: Accessibility (WCAG 2.2 AA)
- All interactive elements keyboard-accessible
- Focus indicators visible on all buttons and form fields
- 4.5:1 contrast ratio for text
- Form fields have associated labels
- Status filter tabs accessible via keyboard arrow keys

### NFR-4: Data Integrity
- Policy versions are immutable after activation (no PATCH on non-draft policies)
- Supersedes chain forms a valid linked list (no cycles, no gaps)
- Audit events recorded atomically with lifecycle transitions (in same SurrealDB transaction)

### NFR-5: Consistency
- Policy shape consistent across all endpoints (list, detail, create response)
- Human-readable predicate rendering identical between rule builder preview and detail view
- Status transition rules enforced at API level, not just UI level

## 5. Business Rules

### BR-1: Policy Status Transitions
```
                +-> testing -> active -> deprecated
               /                  \
draft --------+                    +-> superseded
               \                  /
                +-> active ------+
```
- Valid transitions: draft -> active, draft -> testing, testing -> active, active -> deprecated, active -> superseded (automated when new version activates)
- Invalid transitions: active -> draft, deprecated -> active, superseded -> active

### BR-2: Activation Pre-conditions
- Policy must have at least 1 rule
- Policy must be in `draft` (or `testing`) status
- Activation is idempotent (re-activating an active policy returns current state)

### BR-3: Deprecation Pre-conditions
- Policy must be in `active` status
- Deprecation removes ALL governing and protects edges for this policy

### BR-4: Version Creation
- Only active policies can be versioned (creating a new version of a draft makes no sense)
- New version copies title, description, selector, rules, human_veto_required, max_ttl
- Version number auto-increments (source version + 1)
- New version is `draft` -- must be explicitly activated

### BR-5: Agent Authorization
- Agent identity type determined from `identity.type` field in SurrealDB
- Agent identities: 403 on POST, PATCH, DELETE to policy endpoints
- Agent identities: 200 on GET to policy endpoints
- Human identities: full access if member_of workspace

## 6. Domain Glossary

| Term | Definition |
|------|------------|
| **Policy** | A named set of governance rules governing agent behavior in a workspace |
| **Rule** | A single allow/deny predicate within a policy, evaluated against intent context |
| **Predicate** | A structured condition ({field, operator, value}) matched against intent data |
| **Selector** | Scope filter determining which agents/resources a policy applies to |
| **Effect** | The outcome of a rule match: "allow" (permit intent) or "deny" (reject intent) |
| **Governing edge** | Graph relation from identity to policy (identity -> governing -> policy) |
| **Protects edge** | Graph relation from policy to workspace (policy -> protects -> workspace) |
| **Supersedes** | Pointer from a newer policy version to the version it replaced |
| **Policy trace** | Array of PolicyTraceEntry records showing how each rule was evaluated against an intent |
| **Veto window** | Time period during which a human can approve or reject a policy-flagged intent |

## 7. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Rule builder complexity overwhelms org admins | Medium | High | Progressive disclosure: basic mode (3 common operators) + advanced mode (all operators). Human-readable preview validates understanding. |
| Policy conflicts cause unexpected agent blocking | Medium | High | Pre-flight conflict check on activation. Surface conflicts as warnings in confirmation dialog. |
| Version chain corruption from concurrent edits | Low | High | Optimistic concurrency: version creation checks current version hasn't changed since form load. |
| Agent authorization bypass via crafted requests | Low | Critical | Server-side identity.type check in route handler, not just UI hiding. Acceptance tests for 403 responses. |
| PolicyTraceEntry schema drift between authorizer and UI | Medium | Medium | Shared TypeScript type. Acceptance test creating intent -> evaluating -> fetching trace -> asserting shape. |

## 8. Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `policy` SurrealDB table and schema | **Exists** | No migration needed |
| `governing` and `protects` relation tables | **Exist** | No migration needed |
| `createPolicy()`, `activatePolicy()`, `deprecatePolicy()` | **Exist** | Reuse in route handlers |
| `createPolicyAuditEvent()` | **Exists** | Call from lifecycle endpoints |
| `PolicyRecord`, `PolicyRule`, `PolicyTraceEntry` types | **Exist** | Import in routes and UI |
| `intent.evaluation.policy_trace` persistence | **Exists** | Read in review UI |
| Better Auth session middleware | **Exists** | Reuse for auth check |
| React router + workspace sidebar | **Exist** | Add "Policies" nav item |
| Learning Library UI patterns (list + filters + dialogs) | **Exist** | Follow as UI pattern reference |
