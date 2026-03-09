# Unified Identity Node -- User Stories

## Story Map

```
Job 1: Unified Audit Trail (MUST)
  |
  +-- US-UI-001: Identity Hub Schema (foundation)
  +-- US-UI-002: Identity Wrapping (person + agent creation)
  +-- US-UI-003: Edge Migration (repoint all ownership)
  +-- US-UI-004: Auth Rewiring (session + account)
  +-- US-UI-005: Dual-Label Audit Trail (the payoff query)
  |
Job 2: Scoped Authorization (SHOULD)
  |
  +-- US-UI-006: Role-Based Authority with Overrides
  |
Job 4: Full-Provenance Extraction (COULD)
  |
  +-- US-UI-007: Agent Mention Resolution in Extraction Pipeline
```

Row 1 (MVP): US-UI-001 through US-UI-005 (must-have, sequential dependency)
Row 2: US-UI-006 (should-have, depends on US-UI-002)
Row 3: US-UI-007 (could-have, depends on US-UI-002 + US-UI-003)

---

# US-UI-001: Identity Hub and Spoke Schema

## Problem
Marcus is a workspace owner running an AI-native business management platform where agents (PM Agent, Code Agent) perform actions alongside humans. He cannot answer "who did this?" because agents have no first-class identity -- `agent_session` uses bare strings, and all ownership edges point at `person` records only. Agent actions are either invisible or falsely attributed.

## Who
- Workspace owner | Brownfield system with existing person + agent_session tables | Needs unified identity model before any downstream work is possible

## Solution
Create the `identity` hub table, `agent` spoke table, and spoke relation edge tables (`identity_person`, `identity_agent`) via a SurrealDB schema migration. The `identity` table holds shared fields (name, type, role, embedding, workspace). The `person` table remains as-is for human-specific fields. The `agent` table holds agent-specific fields (agent_type, model, managed_by).

## Domain Examples

### 1: Human Identity Structure -- Marcus Oliveira
Marcus Oliveira is the workspace owner. His `identity` record has `name: "Marcus Oliveira"`, `type: "human"`, `role: "owner"`, `workspace: workspace:san-jose`. An `identity_person` edge links to `person:marcus` which retains `contact_email: "marcus@conductor.dev"` and `image`. OAuth provider data lives in the `account` table (linked via `identity_id`).

### 2: Agent Identity Structure -- PM Agent
The PM Agent for workspace san-jose gets `identity` record with `name: "PM Agent"`, `type: "agent"`, `role: "management"`, `workspace: workspace:san-jose`. An `identity_agent` edge links to `agent:pm-ws-san-jose` which has `agent_type: "management"`, `model: "claude-sonnet-4-20250514"`, `managed_by: identity:marcus-human`.

### 3: Invalid Type Rejection -- Schema Enforcement
A developer accidentally tries to create an identity with `type: "bot"`. The SurrealDB SCHEMAFULL assertion rejects the record with a validation error, enforcing the `['human', 'agent', 'system']` enum constraint at the database level.

## UAT Scenarios (BDD)

### Scenario: Human identity hub record created successfully
Given workspace "san-jose" exists
When an identity record is created with name "Marcus Oliveira", type "human", role "owner", workspace "san-jose"
Then the identity record is persisted with all fields
And a created_at timestamp is set automatically

### Scenario: Agent identity hub record created successfully
Given workspace "san-jose" exists
When an identity record is created with name "PM Agent", type "agent", role "management", workspace "san-jose"
Then the identity record is persisted with all fields
And the type field is "agent"

### Scenario: Agent spoke table enforces managed_by
Given identity "Marcus Oliveira" exists with type "human"
When an agent spoke record is created with agent_type "management", model "claude-sonnet-4-20250514", managed_by identity "Marcus Oliveira"
Then the agent spoke record is persisted
And managed_by references a valid identity record

### Scenario: Spoke relation edges connect hub to spoke
Given identity "Marcus Oliveira" exists and person "Marcus Oliveira" exists
When an identity_person relation edge is created from identity to person
Then the edge is persisted as TYPE RELATION IN identity OUT person
And traversal from identity via ->identity_person->person returns the person record

### Scenario: Invalid identity type rejected by schema
Given workspace "san-jose" exists
When an identity record is created with type "bot"
Then the creation fails with a schema validation error
And types "human", "agent", and "system" are all accepted

## Acceptance Criteria
- [ ] `identity` table is SCHEMAFULL with fields: name (string), type (string, ASSERT IN ['human', 'agent', 'system']), role (option<string>), embedding (option<array<float>>), workspace (record<workspace>), created_at (datetime)
- [ ] `agent` table is SCHEMAFULL with fields: agent_type (string), model (option<string>), managed_by (record<identity>), created_at (datetime)
- [ ] `identity_person` is TYPE RELATION IN identity OUT person
- [ ] `identity_agent` is TYPE RELATION IN identity OUT agent
- [ ] HNSW index defined on identity.embedding for vector search
- [ ] `person.identities` field removed (redundant with `account` table)
- [ ] Invalid type values are rejected at schema level

## Technical Notes
- Migration file: `schema/migrations/00XX_unified_identity.surql` (determine next sequence number from existing migrations)
- Apply via `bun migrate` per project convention
- Wrap in `BEGIN TRANSACTION; ... COMMIT TRANSACTION;`
- `person.identities` field (array of OAuth provider/id pairs) is removed in this migration — it is redundant with the `account` table which already stores `provider_id`, `account_id`, and OAuth tokens per provider. Use `REMOVE FIELD identities ON person;` in the migration.
- No other `person` table fields are modified in this story -- ownership edge changes happen in US-UI-003
- The `type` enum includes `'system'` for automated system-level actions (e.g., scheduled jobs, platform triggers) that are neither human nor agent-initiated.

## Dependencies
- None (foundation story)

---

# US-UI-002: Identity Wrapping and Agent Registration

## Problem
Marcus has existing `person` records for humans and disconnected `agent_session` records with bare string identifiers. After the hub-spoke schema exists (US-UI-001), these existing records need to be wrapped in `identity` hub nodes, and template agent identities need to be registered, so that all downstream edge migration (US-UI-003) has identity records to point at.

## Who
- Workspace owner | Has existing person records and knows which agent types operate in each workspace | Needs identity records to exist before edges can migrate

## Solution
Create workspace bootstrap logic that: (1) wraps each existing `person` in an `identity` hub with type "human" and creates the spoke edge, (2) registers template agent identities for each known agent type with managed_by pointing to the workspace owner's identity. This runs as a one-time bootstrap for existing workspaces and as part of workspace creation for new ones.

## Domain Examples

### 1: Wrapping Marcus Oliveira -- Existing Human
Person record `person:marcus` exists with `name: "Marcus Oliveira"`, `contact_email: "marcus@conductor.dev"`. The wrapping process creates `identity:marcus-human-san-jose` with `name: "Marcus Oliveira"`, `type: "human"`, `role: "owner"`, and creates an `identity_person` edge connecting them. The person record is not modified.

### 2: Registering PM Agent Template -- New Agent Identity
No PM Agent identity exists yet. The bootstrap creates `identity:pm-agent-san-jose` with `name: "PM Agent"`, `type: "agent"`, `role: "management"`, creates agent spoke `agent:pm-san-jose` with `agent_type: "management"`, `managed_by: identity:marcus-human-san-jose`, and creates the `identity_agent` edge.

### 3: Idempotent Bootstrap -- Running Twice
Marcus triggers workspace bootstrap a second time. The wrapping process detects that `identity:marcus-human-san-jose` already exists with an `identity_person` edge to `person:marcus` and skips creation. No duplicate identities are created.

## UAT Scenarios (BDD)

### Scenario: Existing person wrapped in identity hub
Given person "Marcus Oliveira" exists in workspace "san-jose" with contact_email "marcus@conductor.dev"
And no identity record exists for "Marcus Oliveira"
When the identity wrapping bootstrap runs for workspace "san-jose"
Then identity "Marcus Oliveira" exists with type "human" and role "owner"
And an identity_person edge connects the identity to person "Marcus Oliveira"
And person "Marcus Oliveira" retains all existing fields unchanged

### Scenario: Template agent identities registered
Given workspace "san-jose" exists with owner identity "Marcus Oliveira"
And the workspace has agent types ["management", "code_agent", "observer"]
When the agent registration bootstrap runs
Then identity "PM Agent" exists with type "agent" and role "management"
And identity "Code Agent" exists with type "agent" and role "coder"
And identity "Analytics Agent" exists with type "agent" and role "observer"
And each agent spoke has managed_by pointing to identity "Marcus Oliveira"

### Scenario: Bootstrap is idempotent
Given identity "Marcus Oliveira" already exists with an identity_person edge
When the identity wrapping bootstrap runs again for workspace "san-jose"
Then no new identity record is created for "Marcus Oliveira"
And the existing identity_person edge is preserved
And the total identity count for "Marcus Oliveira" remains 1

### Scenario: Agent managed_by chain resolves to human
Given identity "PM Agent" was registered with managed_by "Marcus Oliveira"
When the managed_by chain is traversed from "PM Agent"
Then the chain reaches identity "Marcus Oliveira" with type "human" in 1 hop

### Scenario: New workspace creation includes identity bootstrap
Given a new workspace "tokyo-v2" is being created by person "Ana Torres"
When the workspace creation completes
Then identity "Ana Torres" exists with type "human" and role "owner" in workspace "tokyo-v2"
And template agent identities are registered with managed_by "Ana Torres"

## Acceptance Criteria
- [ ] Every person record in a workspace has a corresponding identity (type: human) with spoke edge
- [ ] Template agent identities created for management, code_agent, and observer types
- [ ] Each agent spoke has managed_by pointing to the workspace owner's human identity
- [ ] Bootstrap is idempotent -- running twice produces no duplicates
- [ ] New workspace creation automatically runs identity bootstrap
- [ ] managed_by chain from any agent resolves to a human identity within bounded hops

## Technical Notes
- Bootstrap logic belongs in workspace creation flow (`workspace/workspace-routes.ts` or dedicated bootstrap module)
- Existing workspace migration: per project convention, schema changes are breaking and old data is discarded. No backfill of existing person records into identity wrappers. The bootstrap runs on workspace creation; existing workspaces get fresh data on next setup. If a one-time bootstrap for existing workspaces is needed, it can be a versioned migration script applied via `bun migrate`.
- Agent type list is derived from existing `authority_scope` agent_type enum values
- No backwards compatibility needed -- this is additive (new records only, person table unchanged)

## Dependencies
- US-UI-001 (identity hub schema must exist)

---

# US-UI-003: Edge Migration -- Ownership and Attribution

## Problem
Marcus has identity records for humans and agents (from US-UI-002), but all ownership edges (`owns`, `member_of`) and attribution fields (`task.owner`, `decision.decided_by`, `feature.owner`, `question.assigned_to`) still point at `person` records. The system cannot answer "who owns this?" with a unified identity -- it only sees humans, not agents.

## Who
- Workspace owner | Needs all graph edges to speak "identity" language | Largest surface area change in the migration

## Solution
Schema migration that changes all `record<person>` fields to `record<identity>` on task, feature, decision, and question tables. Update `owns` and `member_of` relation table constraints from `IN person` to `IN identity`. Update all TypeScript types and queries that reference `RecordId<"person">` in ownership contexts.

## Domain Examples

### 1: Task Ownership Migration -- "Implement OAuth flow"
Task `task:oauth` has `owner: person:marcus`. After migration, the field type changes to `record<identity>` and the value becomes `identity:marcus-human-san-jose`. The PM Agent can now also own tasks: `task:ci-pipeline` gets `owner: identity:pm-agent-san-jose`.

### 2: Decision Attribution -- "Use hub-and-spoke model"
Decision `decision:hub-spoke` has `decided_by: person:marcus`. After migration, `decided_by` type becomes `record<identity>`. A future decision proposed by the PM Agent would have `decided_by: identity:pm-agent-san-jose`, `confirmed_by: identity:marcus-human-san-jose`.

### 3: Relation Table Constraint -- owns
The `owns` relation table currently has `TYPE RELATION IN person OUT task | project | feature`. After migration, it becomes `TYPE RELATION IN identity OUT task | project | feature`. Existing edges are recreated with identity records as the IN node.

## UAT Scenarios (BDD)

### Scenario: Task owner field accepts identity record
Given identity "Marcus Oliveira" exists with type "human"
When task "Implement OAuth flow" is created with owner identity "Marcus Oliveira"
Then the task is persisted with owner of type record<identity>
And querying the task returns owner identity "Marcus Oliveira"

### Scenario: Agent identity can own a task
Given identity "PM Agent" exists with type "agent"
When the PM Agent creates task "Set up CI pipeline"
Then the task has owner pointing to identity "PM Agent"
And the owner field type is record<identity> (same type as human-owned tasks)

### Scenario: Decision has split attribution (proposed by agent, confirmed by human)
Given identity "PM Agent" exists with type "agent"
And identity "Marcus Oliveira" exists with type "human"
When decision "Prioritize auth feature" is created with decided_by "PM Agent"
And later confirmed by "Marcus Oliveira"
Then decided_by references identity "PM Agent"
And confirmed_by references identity "Marcus Oliveira"

### Scenario: owns relation uses identity as source node
Given identity "Marcus Oliveira" exists with type "human"
And task "Implement OAuth flow" exists
When an owns edge is created from "Marcus Oliveira" to the task
Then the relation is valid with IN identity OUT task
And traversal SELECT ->owns->task FROM identity:marcus returns the task

### Scenario: member_of relation connects identity to workspace
Given identity "Marcus Oliveira" exists with type "human"
And workspace "san-jose" exists
When a member_of edge connects "Marcus Oliveira" to "san-jose"
Then the relation is valid with IN identity OUT workspace
And traversal SELECT <-member_of<-identity FROM workspace returns "Marcus Oliveira"

### Scenario: No remaining record<person> in ownership fields
Given the edge migration has completed
When schema info is queried for tables task, feature, decision, question
Then no field has type record<person> for ownership/attribution
And all ownership fields use record<identity>

## Acceptance Criteria
- [ ] `task.owner` type changed from `record<person>` to `record<identity>`
- [ ] `feature.owner` type changed from `record<person>` to `record<identity>`
- [ ] `decision.decided_by` type changed from `record<person>` to `record<identity>`
- [ ] `decision.confirmed_by` type changed from `record<person>` to `record<identity>`
- [ ] `question.assigned_to` type changed from `record<person>` to `record<identity>`
- [ ] `owns` relation changed to `IN identity OUT task | project | feature`
- [ ] `member_of` relation changed to `IN identity OUT workspace`
- [ ] All TypeScript `RecordId<"person">` usages in ownership contexts changed to `RecordId<"identity">`
- [ ] Graph traversal queries return correct results with identity references

## Technical Notes
- Schema migration: `DEFINE FIELD OVERWRITE owner ON task TYPE option<record<identity>>;` (using OVERWRITE per convention)
- No data migration needed (project convention: schema changes are breaking, old data discarded)
- TypeScript impact assessment: grep for `RecordId<"person">` and `record<person>` across all server files
- Relation table changes: `ALTER TABLE owns` or `DEFINE TABLE OVERWRITE owns TYPE RELATION IN identity OUT task | project | feature;`
- The `person` table continues to exist as a spoke -- only references FROM other tables TO person are removed for ownership fields
- `extraction/person.ts` still creates person records -- but the identity wrapping (US-UI-002) creates the hub node, and ownership edges point at the hub

## Dependencies
- US-UI-001 (identity table schema)
- US-UI-002 (identity records must exist for edge targets)

---

# US-UI-004: Auth Rewiring -- Session and Account Migration

## Problem
Marcus's login flow (OAuth via GitHub) creates sessions and accounts pointing at `person` records. After edge migration (US-UI-003), the rest of the system speaks "identity" but the auth layer still speaks "person." This creates a type mismatch: the session says "person:marcus" but the task owner says "identity:marcus-human." The system cannot connect "who is logged in" with "who owns this task."

## Who
- Workspace owner | Authenticates via GitHub OAuth | Must not lose ability to log in during migration

## Solution
Rename `session.person_id` to `session.identity_id` (type `record<identity>`). Rename `account.person_id` to `account.identity_id`. Update `iam/identity.ts` resolution functions to return `RecordId<"identity">` instead of `RecordId<"person">`. The resolution path becomes: OAuth callback -> find person by email -> find wrapping identity via reverse spoke traversal -> create session with identity reference.

## Domain Examples

### 1: OAuth Login for Marcus Oliveira
Marcus clicks "Sign in with GitHub." The OAuth callback returns email "marcus@conductor.dev." The system finds `person:marcus` by email, then traverses the reverse spoke edge (`<-identity_person<-identity`) to find `identity:marcus-human-san-jose`. The session is created with `identity_id: identity:marcus-human-san-jose`.

### 2: Session Lookup for Chat Message
Marcus sends a chat message. The ingress handler extracts the session token, looks up the session, and gets `identity_id: identity:marcus-human-san-jose`. The chat context is built with this identity as the actor. `humanPresent` is set to `true` because `identity.type = 'human'`.

### 3: MCP Agent Authentication
The Code Agent connects via MCP protocol. MCP auth resolves the agent's credentials to `identity:code-agent-san-jose` (type: "agent"). The chat context has `humanPresent = false` and `agentType` derived from the identity's role.

## UAT Scenarios (BDD)

### Scenario: OAuth login creates session with identity reference
Given person "Marcus Oliveira" exists with contact_email "marcus@conductor.dev"
And identity "Marcus Oliveira" wraps person "Marcus Oliveira" via identity_person edge
When Marcus authenticates via GitHub OAuth with email "marcus@conductor.dev"
Then a session is created with identity_id pointing to identity "Marcus Oliveira"
And the session does not contain a person_id field

### Scenario: Session lookup resolves to identity
Given Marcus has an active session with identity_id "Marcus Oliveira"
When the session is looked up by token
Then the result includes identity_id of type record<identity>
And the resolved identity has type "human"

### Scenario: Chat ingress uses identity from session
Given Marcus has an active session with identity_id "Marcus Oliveira"
When Marcus sends a chat message
Then the chat context actor is identity "Marcus Oliveira"
And humanPresent is true (because identity.type = "human")

### Scenario: Account table references identity
Given Marcus has a GitHub OAuth account
When the account record is queried
Then account.identity_id points to identity "Marcus Oliveira"
And the account retains provider_id, access_token, and other OAuth fields

### Scenario: Identity resolution returns identity RecordId
Given person "Marcus Oliveira" exists with contact_email "marcus@conductor.dev"
And identity "Marcus Oliveira" wraps that person
When resolveByEmail("marcus@conductor.dev") is called
Then the return type is RecordId<"identity">
And the returned ID matches identity "Marcus Oliveira"

## Acceptance Criteria
- [ ] `session.person_id` renamed to `session.identity_id` of type `record<identity>`
- [ ] `account.person_id` renamed to `account.identity_id` of type `record<identity>`
- [ ] `resolveIdentity()` returns `RecordId<"identity">`
- [ ] `resolveByEmail()` returns `RecordId<"identity">`
- [ ] OAuth login flow works end-to-end with identity-based sessions
- [ ] Chat ingress correctly resolves user identity from session
- [ ] `humanPresent` flag derived from `identity.type = 'human'`

## Technical Notes
- `iam/identity.ts` is the critical file -- resolution functions must traverse person -> identity spoke edge
- Query pattern: `SELECT <-identity_person<-identity FROM person WHERE contact_email = $email`
- Session table migration: `REMOVE FIELD person_id ON session; DEFINE FIELD identity_id ON session TYPE record<identity>;`
- Account table migration: same pattern as session
- Auth adapter (`auth/adapter.ts`) and config (`auth/config.ts`) must be updated to use identity_id
- This is a critical path change -- auth failure means users cannot log in

## Dependencies
- US-UI-001 (identity table schema)
- US-UI-002 (identity records must exist)
- US-UI-003 (edge migration should complete first so the whole system speaks "identity")

---

# US-UI-005: Dual-Label Audit Trail Query

## Problem
Marcus has unified identities, migrated edges, and rewired auth. But the payoff is missing: he still cannot run the query he most wants -- "show me all suggestions made by agents that were actually implemented." The system has the data but no dedicated query path that returns dual-label attribution (actor + accountable human) for agent actions.

## Who
- Workspace owner | Evaluating AI ROI | Wants to see which agent suggestions led to real outcomes

## Solution
Implement audit trail queries that return dual-label attribution for any entity: the immediate actor (human or agent identity) and, for agent actors, the accountable human resolved via `managed_by` chain on the agent spoke. Surface this through the chat agent's entity detail tool and enable the "agent suggestions that became tasks" query.

## Domain Examples

### 1: PM Agent Suggestion Implemented -- "Prioritize auth feature"
The PM Agent (identity: "PM Agent", managed_by: Marcus) created suggestion "Prioritize auth feature" 30 days ago. Marcus accepted it, creating task "Implement OAuth flow" which is now status "done." The audit query returns: `{ suggestion: "Prioritize auth", suggested_by: "PM Agent", actor_type: "agent", accountable_human: "Marcus Oliveira", task: "Implement OAuth flow", status: "done" }`.

### 2: Code Agent Suggestion Pending -- "Add rate limiting"
The Code Agent suggested "Add rate limiting" 20 days ago. The resulting task "Add API rate limiting" is status "in_progress." The audit query includes this with status "in_progress" so Marcus can see which agent suggestions are still being worked on.

### 3: Human Action -- No Managed-By Chain
Marcus directly created decision "Use SurrealDB for graph." The audit trail shows `actor: "Marcus Oliveira"`, `actor_type: "human"`, `accountable_human: "Marcus Oliveira"` (same person -- no managed_by traversal needed). The dual-label degrades gracefully for human actors.

## UAT Scenarios (BDD)

### Scenario: Query agent suggestions that became implemented tasks
Given PM Agent created suggestion "Prioritize auth feature" 30 days ago
And Marcus accepted it, creating task "Implement OAuth flow" with status "done"
And Code Agent created suggestion "Add rate limiting" 20 days ago
And Marcus accepted it, creating task "Add API rate limiting" with status "in_progress"
When Marcus queries "suggestions by agents that were implemented"
Then the results include "Prioritize auth" by PM Agent linked to task "Implement OAuth flow" (done)
And the results include "Add rate limiting" by Code Agent linked to task "Add API rate limiting" (in_progress)
And each result shows accountable_human "Marcus Oliveira"

### Scenario: Dual-label attribution for agent action
Given PM Agent created task "Set up CI pipeline"
And PM Agent's managed_by chain resolves to Marcus Oliveira
When the task audit trail is queried
Then the result shows actor "PM Agent" with type "agent"
And the result shows accountable_human "Marcus Oliveira"
And the display format is "Created by PM Agent (Managed by Marcus Oliveira)"

### Scenario: Human action shows self as accountable
Given Marcus Oliveira directly created decision "Use SurrealDB for graph"
When the decision audit trail is queried
Then the result shows actor "Marcus Oliveira" with type "human"
And accountable_human is "Marcus Oliveira" (same as actor)

### Scenario: Complete actor history for a task
Given task "Implement OAuth flow" had these actions:
  | action    | actor           | type  |
  | created   | PM Agent        | agent |
  | assigned  | Marcus Oliveira | human |
  | completed | Marcus Oliveira | human |
When the full audit trail for the task is queried
Then all 3 actions are listed chronologically with identity attribution
And agent actions include managed_by human in the response

### Scenario: No unattributed actions in query results
Given the unified identity migration is complete
When Marcus queries all tasks in workspace "san-jose"
Then every task with an owner shows an identity reference
And no task owner is null or references a person record directly

## Acceptance Criteria
- [ ] "Agent suggestions that became tasks" query returns results with dual-label attribution
- [ ] Dual-label format includes actor name, actor type, and accountable human (via managed_by)
- [ ] Human actor actions show self as accountable human (graceful degradation)
- [ ] Entity detail tool returns actor identity with type context
- [ ] Query handles mixed human/agent attribution in results

## Technical Notes
- Query pattern for managed_by resolution: `SELECT ->identity_agent->agent.managed_by AS manager FROM identity WHERE type = 'agent'`
- The "suggestions that became tasks" query depends on existing suggestion -> task graph edges (verify these exist in current schema)
- Chat agent entity detail tool (`chat/tools/get-entity-detail.ts`) needs to return identity type context
- Consider adding a graph query helper for dual-label resolution (reusable across audit queries)
- No new schema changes -- this is a query/code layer change built on top of US-UI-001 through US-UI-004

## Dependencies
- US-UI-001 through US-UI-004 (all schema and migration work must be complete)

---

# US-UI-006: Role-Based Authority with Per-Identity Overrides

## Problem
Marcus wants to give the PM Agent elevated permissions (e.g., auto-confirm decisions) without changing permissions for all "management" type agents. The current `authority_scope` table uses string-based `agent_type` matching -- all agents of the same type get identical permissions with no way to promote or restrict individual agent instances.

## Who
- Workspace owner | Managing multiple agent instances of the same type | Needs granular permission control without losing role-based defaults

## Solution
Modify `authority_scope` to match on `identity.role` instead of `agent_type` string. Add an `authorized_to` relation table for per-identity override edges. Update `checkAuthority()` to check overrides first, then role defaults, then fail-safe blocked.

## Domain Examples

### 1: Role-Based Default -- PM Agent Creates Task
Identity "PM Agent" has `role: "management"`. `authority_scope` has row `{ role: "management", action: "create_task", permission: "auto" }`. When PM Agent tries to create a task, `checkAuthority()` matches on role and returns "auto." No override needed.

### 2: Per-Identity Override -- Lead Coder Confirms Decisions
Identity "Lead Coder" has `role: "coder"`. Role default for "coder" + "confirm_decision" is "provisional." But an `authorized_to` edge exists: `RELATE identity:lead-coder->authorized_to->authority_override:confirm-auto SET permission = "auto"`. When Lead Coder tries to confirm, the override check finds the edge and returns "auto" instead of "provisional."

### 3: No Role, No Override -- Unknown Agent Blocked
Identity "Unknown Agent" has `role: NONE`. No `authorized_to` edges exist. `checkAuthority()` falls through both checks and returns "blocked." The agent cannot perform any action.

## UAT Scenarios (BDD)

### Scenario: Role-based permission resolves from identity role
Given identity "PM Agent" has role "management"
And authority_scope has entry: role "management", action "create_task", permission "auto"
When checkAuthority is called for "PM Agent" and action "create_task"
Then permission "auto" is returned

### Scenario: Per-identity override takes precedence over role
Given identity "Lead Coder" has role "coder"
And authority_scope has: role "coder", action "confirm_decision", permission "provisional"
And authorized_to override grants "Lead Coder" permission "auto" for "confirm_decision"
When checkAuthority is called for "Lead Coder" and action "confirm_decision"
Then permission "auto" is returned from the override

### Scenario: Role default used when no override exists
Given identity "Junior Coder" has role "coder"
And authority_scope has: role "coder", action "confirm_decision", permission "provisional"
And no authorized_to override exists for "Junior Coder"
When checkAuthority is called for "Junior Coder" and action "confirm_decision"
Then permission "provisional" is returned from the role default

### Scenario: No role and no override returns blocked
Given identity "Rogue Agent" has no role (role is NONE)
And no authorized_to override edges exist for "Rogue Agent"
When checkAuthority is called for "Rogue Agent" and action "create_observation"
Then permission "blocked" is returned

### Scenario: Human identity still bypasses authority
Given identity "Marcus Oliveira" has type "human" and role "owner"
And humanPresent is true in the chat context
When Marcus attempts action "confirm_decision"
Then authority check is bypassed entirely
And permission "auto" is returned

## Acceptance Criteria
- [ ] `authority_scope` matches on `role` field (string) instead of / in addition to `agent_type`
- [ ] `authorized_to` relation table defined: IN identity OUT authority_override (or similar)
- [ ] `checkAuthority()` resolution order: override edge -> role default -> blocked
- [ ] Human identity with humanPresent still bypasses authority (unchanged behavior)
- [ ] Override edges are optional -- system works with role defaults alone

## Technical Notes
- `authority_scope` table may need a migration to add `role` field or rename `agent_type` to `role`
- `authorized_to` relation: `DEFINE TABLE authorized_to TYPE RELATION IN identity OUT authority_scope;` (or a dedicated override table)
- `checkAuthority()` in `iam/authority.ts` needs a new first step: query `authorized_to` edges for the identity
- Consider workspace-scoped overrides (override edge has workspace field)
- Backwards compatibility: if `agent_type` field is retained alongside `role`, existing seed data continues to work during transition

## Dependencies
- US-UI-001 (identity table with role field)
- US-UI-002 (agent identities must have roles assigned)

---

# US-UI-007: Agent Mention Resolution in Extraction Pipeline

## Problem
When Marcus types "the PM agent suggested we should prioritize auth," the extraction pipeline resolves "Marcus" to a person record but ignores "the PM agent" entirely. Agent contributions mentioned in conversation become graph blind spots -- they exist in message text but have no identity node in the knowledge graph. This breaks provenance for the "agent suggestions that were implemented" query.

## Who
- Workspace owner | Converses about agent actions in natural language | Needs extraction pipeline to recognize agent references

## Solution
Extend the extraction pipeline to recognize agent role/name mentions (e.g., "the PM agent," "Code Agent") and resolve them to the corresponding `identity` record in the workspace. The resolution logic looks up identities with `type: 'agent'` in the current workspace, optionally filtered by `managed_by` chain to the current user.

## Domain Examples

### 1: Role-Based Mention -- "the PM agent suggested"
Marcus types "the PM agent suggested we should prioritize the auth feature." The extraction pipeline recognizes "the PM agent" as an agent reference, queries `SELECT * FROM identity WHERE type = 'agent' AND workspace = $ws AND ->identity_agent->agent.agent_type = 'management'`, and resolves to `identity:pm-agent-san-jose`. The suggestion entity is linked to this identity as the source actor.

### 2: Name-Based Mention -- "Code Agent finished the task"
Marcus types "Code Agent finished the OAuth implementation task." The extraction pipeline matches "Code Agent" against identity names where type = 'agent', finds `identity:code-agent-san-jose`, and creates an attribution edge.

### 3: Ambiguous Mention -- "an agent suggested"
Marcus types "an agent suggested we add rate limiting." The mention "an agent" is too generic to resolve to a specific identity. The extraction pipeline does not create a false-positive attribution. The suggestion is created without an agent identity link, preserving graph integrity over completeness.

## UAT Scenarios (BDD)

### Scenario: PM agent role mention resolved to identity
Given identity "PM Agent" exists with type "agent" in workspace "san-jose"
And agent spoke has agent_type "management"
When Marcus sends message "the PM agent suggested we should prioritize auth"
And the extraction pipeline processes the message
Then the extracted suggestion is linked to identity "PM Agent" as source actor

### Scenario: Agent name mention resolved to identity
Given identity "Code Agent" exists with type "agent" in workspace "san-jose"
When Marcus sends message "Code Agent finished the OAuth task"
And the extraction pipeline processes the message
Then the extracted action is attributed to identity "Code Agent"

### Scenario: Ambiguous agent mention not resolved (no false positive)
Given multiple agent identities exist in workspace "san-jose"
When Marcus sends message "an agent suggested we add rate limiting"
And the extraction pipeline processes the message
Then no agent identity attribution is created for the ambiguous mention
And the extracted entity is created without a specific agent source

### Scenario: Non-existent agent mention not resolved
Given no agent identity with name "Design Agent" exists in workspace "san-jose"
When Marcus sends message "the Design Agent recommended new colors"
And the extraction pipeline processes the message
Then no identity attribution is created for "Design Agent"

### Scenario: Human and agent mentions resolved in same message
Given identity "Marcus Oliveira" exists with type "human"
And identity "PM Agent" exists with type "agent"
When Marcus sends message "I agreed with the PM agent's suggestion to add auth"
And the extraction pipeline processes the message
Then "I" resolves to identity "Marcus Oliveira"
And "the PM agent" resolves to identity "PM Agent"

## Acceptance Criteria
- [ ] Extraction pipeline recognizes agent role mentions ("the PM agent," "the code agent")
- [ ] Extraction pipeline recognizes agent name mentions ("PM Agent," "Code Agent")
- [ ] Resolved agent mentions create identity attribution edges in the graph
- [ ] Ambiguous mentions ("an agent," "the agent") do not create false-positive attributions
- [ ] Non-existent agent references do not create phantom identity records
- [ ] Resolution scoped to current workspace (no cross-workspace agent matching)

## Technical Notes
- Modify `extraction/person.ts` (or create sibling `extraction/identity.ts`) to handle agent resolution
- Resolution query: `SELECT * FROM identity WHERE type = 'agent' AND workspace = $ws` then fuzzy-match against mention text
- May need extraction prompt changes to instruct the model to identify agent references (currently extraction schema focuses on person, task, decision, question)
- Consider confidence threshold: only resolve mentions with high confidence to avoid noise
- This story is deliberately scoped to extraction-time resolution. Real-time agent attribution (when the agent itself writes to the graph) is already handled by US-UI-003/005.

## Dependencies
- US-UI-001 (identity table schema)
- US-UI-002 (agent identities must be registered)
- US-UI-003 (attribution edges must use record<identity>)

---

# Definition of Ready Validation

## US-UI-001: Identity Hub and Spoke Schema

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Agent actions invisible due to person-only identity model; domain language used |
| User/persona identified | PASS | Marcus, workspace owner with existing person + agent_session data |
| 3+ domain examples | PASS | Human identity (Marcus), Agent identity (PM Agent), Invalid type rejection |
| UAT scenarios (3-7) | PASS | 5 scenarios covering creation, spoke edges, and validation |
| AC derived from UAT | PASS | 6 AC items mapped from scenarios |
| Right-sized | PASS | ~1-2 days (schema migration only, no data migration), 5 scenarios |
| Technical notes | PASS | Migration file naming, transaction wrapping, bun migrate |
| Dependencies tracked | PASS | None (foundation) |

**DoR Status**: PASSED

## US-UI-002: Identity Wrapping and Agent Registration

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Existing records need wrapping before edge migration can proceed |
| User/persona identified | PASS | Marcus, workspace owner with existing person records |
| 3+ domain examples | PASS | Wrapping Marcus, Registering PM Agent, Idempotent bootstrap |
| UAT scenarios (3-7) | PASS | 5 scenarios covering wrapping, registration, idempotency, managed_by, new workspace |
| AC derived from UAT | PASS | 6 AC items mapped from scenarios |
| Right-sized | PASS | ~2 days (bootstrap logic + one-time migration), 5 scenarios |
| Technical notes | PASS | Bootstrap location, agent type derivation, no backwards compat |
| Dependencies tracked | PASS | US-UI-001 identified |

**DoR Status**: PASSED

## US-UI-003: Edge Migration

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Ownership edges speak "person" while identities now exist; type mismatch |
| User/persona identified | PASS | Marcus, workspace owner needing unified ownership language |
| 3+ domain examples | PASS | Task ownership, Decision attribution, Relation table constraint |
| UAT scenarios (3-7) | PASS | 6 scenarios covering task, agent ownership, decisions, relations, completeness |
| AC derived from UAT | PASS | 9 AC items covering all field changes and relation updates |
| Right-sized | PASS | ~2-3 days (schema + TypeScript changes), 6 scenarios |
| Technical notes | PASS | DEFINE FIELD OVERWRITE pattern, TypeScript grep scope, person table unchanged |
| Dependencies tracked | PASS | US-UI-001, US-UI-002 identified |

**DoR Status**: PASSED

## US-UI-004: Auth Rewiring

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Auth layer speaks "person" while system speaks "identity"; login would break |
| User/persona identified | PASS | Marcus authenticating via GitHub OAuth |
| 3+ domain examples | PASS | OAuth login, Session lookup, MCP agent auth |
| UAT scenarios (3-7) | PASS | 5 scenarios covering OAuth, session, chat ingress, account, resolution |
| AC derived from UAT | PASS | 7 AC items mapped from scenarios |
| Right-sized | PASS | ~2 days (auth is focused scope), 5 scenarios |
| Technical notes | PASS | Critical file identified, query pattern, migration approach |
| Dependencies tracked | PASS | US-UI-001, US-UI-002, US-UI-003 identified |

**DoR Status**: PASSED

## US-UI-005: Dual-Label Audit Trail Query

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | System has data but no query path for dual-label audit trail |
| User/persona identified | PASS | Marcus evaluating AI ROI |
| 3+ domain examples | PASS | Implemented suggestion, Pending suggestion, Human action (no chain) |
| UAT scenarios (3-7) | PASS | 5 scenarios covering agent suggestions, dual-label, human, history, completeness |
| AC derived from UAT | PASS | 5 AC items mapped from scenarios |
| Right-sized | PASS | ~1-2 days (query + tool layer, no schema), 5 scenarios |
| Technical notes | PASS | Query pattern, suggestion->task edges, entity detail tool, reusable helper |
| Dependencies tracked | PASS | US-UI-001 through US-UI-004 |

**DoR Status**: PASSED

## US-UI-006: Role-Based Authority with Overrides

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Cannot differentiate permissions between agents of same type |
| User/persona identified | PASS | Marcus managing multiple agent instances |
| 3+ domain examples | PASS | Role default (PM Agent), Override (Lead Coder), Blocked (Unknown Agent) |
| UAT scenarios (3-7) | PASS | 5 scenarios covering role, override, default, blocked, human bypass |
| AC derived from UAT | PASS | 5 AC items mapped from scenarios |
| Right-sized | PASS | ~2 days (authority_scope migration + checkAuthority change), 5 scenarios |
| Technical notes | PASS | Migration approach, relation table, resolution order, backwards compat note |
| Dependencies tracked | PASS | US-UI-001, US-UI-002 |

**DoR Status**: PASSED

## US-UI-007: Agent Mention Resolution

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | Agent mentions in conversation are graph blind spots |
| User/persona identified | PASS | Marcus conversing about agent actions in natural language |
| 3+ domain examples | PASS | Role mention, Name mention, Ambiguous mention |
| UAT scenarios (3-7) | PASS | 5 scenarios covering role, name, ambiguous, non-existent, mixed |
| AC derived from UAT | PASS | 6 AC items mapped from scenarios |
| Right-sized | PASS | ~2-3 days (extraction prompt + resolution logic), 5 scenarios |
| Technical notes | PASS | File locations, resolution query, prompt changes, confidence threshold |
| Dependencies tracked | PASS | US-UI-001, US-UI-002, US-UI-003 |

**DoR Status**: PASSED

---

All 7 stories pass DoR. Ready for DESIGN wave handoff.
