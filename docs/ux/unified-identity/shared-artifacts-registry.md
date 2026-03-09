# Shared Artifacts Registry: Unified Identity

## Purpose
Track all data values that flow across journey steps, ensuring single source of truth and documented consumers. Untracked artifacts are the primary cause of horizontal integration failures.

---

## Artifacts

### identity_type_enum

| Property | Value |
|----------|-------|
| **Source of Truth** | `schema/migrations/00XX_unified_identity.surql` -- ASSERT clause on identity.type |
| **Values** | `'human'`, `'agent'` |
| **Owner** | Schema migration (Step 1) |
| **Integration Risk** | HIGH -- enum mismatch breaks identity classification across entire system |
| **Validation** | `INFO FOR TABLE identity;` must show ASSERT with matching values |

**Consumers**:
- `iam/authority.ts` -- determines whether to bypass auth (human) or check roles (agent)
- `extraction/person.ts` -- identity resolution must distinguish human vs agent mentions
- `chat/context.ts` -- sets `humanPresent` flag based on identity type
- Audit queries -- filter by type for "show me agent actions" queries
- UI entity detail rendering -- icon/label differentiation

---

### identity_role_values

| Property | Value |
|----------|-------|
| **Source of Truth** | Workspace bootstrap seed data + `authority_scope` table role entries |
| **Values** | `'owner'`, `'management'`, `'coder'`, `'observer'` (extensible) |
| **Owner** | Workspace bootstrap (Step 2) + Authority scope seeding (Step 5) |
| **Integration Risk** | HIGH -- role value created during identity registration must match roles recognized by authority_scope |
| **Validation** | Every role value assigned to an identity must have at least one authority_scope row |

**Consumers**:
- `iam/authority.ts` -- `checkAuthority()` matches identity.role to authority_scope.role
- Agent template creation -- assigns role during workspace bootstrap
- Per-identity override edges -- overrides reference the baseline role
- Permission audit queries -- "what can agents with role X do?"

---

### record_identity_type

| Property | Value |
|----------|-------|
| **Source of Truth** | Schema migration (Step 3) + TypeScript type definitions |
| **Type** | `record<identity>` (SurrealDB) / `RecordId<"identity">` (TypeScript) |
| **Owner** | Edge migration (Step 3) |
| **Integration Risk** | HIGH -- every file using `RecordId<"person">` for ownership must change to `RecordId<"identity">` |
| **Validation** | TypeScript compilation -- no remaining `RecordId<"person">` in ownership contexts |

**Consumers**:
- `task.owner` -- record<identity>
- `feature.owner` -- record<identity>
- `decision.decided_by` -- record<identity>
- `decision.confirmed_by` -- record<identity>
- `question.assigned_to` -- record<identity>
- `owns` relation table -- IN identity OUT task|project|feature
- `member_of` relation table -- IN identity OUT workspace
- `session.identity_id` -- record<identity> (renamed from person_id)
- `account.identity_id` -- record<identity> (renamed from person_id)
- All TypeScript files previously importing/using `RecordId<"person">` for ownership

---

### managed_by_edge

| Property | Value |
|----------|-------|
| **Source of Truth** | `agent` spoke table, `managed_by` field of type `record<identity>` |
| **Owner** | Agent spoke creation (Step 2) |
| **Integration Risk** | MEDIUM -- broken edge breaks accountability chain and dual-label audit rendering |
| **Validation** | Every agent spoke must have managed_by pointing to an identity with type 'human' |

**Consumers**:
- Audit trail dual-label rendering ("Created by PM Agent (Managed by Marcus)")
- Accountability chain queries -- traverse managed_by until type = 'human'
- Agent performance dashboard -- group by managing human
- Compromised session isolation -- identify which human's agents are affected

---

### spoke_relation_tables

| Property | Value |
|----------|-------|
| **Source of Truth** | `schema/migrations/00XX_unified_identity.surql` |
| **Tables** | `identity_person` (TYPE RELATION IN identity OUT person), `identity_agent` (TYPE RELATION IN identity OUT agent) |
| **Owner** | Schema migration (Step 1) |
| **Integration Risk** | MEDIUM -- spoke edges must exist for every identity or detail queries return empty |
| **Validation** | Every identity record must have exactly one outgoing spoke edge (identity_person OR identity_agent, not both) |

**Consumers**:
- Entity detail queries -- follow spoke edge to get person-specific or agent-specific fields
- Identity resolution -- find identity from person email via reverse spoke traversal
- Audit queries -- join identity with spoke for type-specific rendering

---

### authority_resolution_chain

| Property | Value |
|----------|-------|
| **Source of Truth** | `iam/authority.ts` -- `checkAuthority()` function |
| **Resolution Order** | 1. Per-identity override edge, 2. Role-based authority_scope, 3. Blocked (fail-safe) |
| **Owner** | Authority migration (Step 5) |
| **Integration Risk** | HIGH -- incorrect resolution order could grant unintended permissions |
| **Validation** | Integration test: override > role default > blocked for same identity and action |

**Consumers**:
- `requireAuthorizedContext()` -- every tool execution
- MCP auth -- agent requests via MCP protocol
- Permission audit -- "why does this agent have this permission?"

---

### session_identity_ref

| Property | Value |
|----------|-------|
| **Source of Truth** | Schema migration for session table |
| **Field** | `session.identity_id` TYPE `record<identity>` (replaces `session.person_id`) |
| **Owner** | Auth rewiring (Step 4) |
| **Integration Risk** | HIGH -- auth failure means users cannot log in |
| **Validation** | End-to-end OAuth login test must pass with identity-based session |

**Consumers**:
- `auth/adapter.ts` -- session creation and lookup
- `auth/config.ts` -- session validation
- `chat/chat-ingress.ts` -- user resolution from session
- `mcp/auth.ts` -- MCP request authentication

---

## Consistency Matrix

| Artifact | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 | Step 6 |
|----------|--------|--------|--------|--------|--------|--------|
| identity_type_enum | DEFINE | USE | USE | -- | USE | USE |
| identity_role_values | -- | ASSIGN | -- | -- | CHECK | QUERY |
| record_identity_type | -- | -- | DEFINE | USE | -- | USE |
| managed_by_edge | -- | CREATE | -- | -- | -- | TRAVERSE |
| spoke_relation_tables | DEFINE | CREATE EDGES | -- | TRAVERSE | -- | TRAVERSE |
| authority_resolution_chain | -- | -- | -- | -- | DEFINE | -- |
| session_identity_ref | -- | -- | -- | DEFINE | -- | -- |

**Reading the matrix**: DEFINE = source of truth created, USE = consumed, ASSIGN = values written, CREATE = instances created, CHECK = validated against, TRAVERSE = graph traversal, QUERY = read in queries.
