# Unified Identity: Component Boundaries

## Affected Components

### 1. Schema Layer (SurrealDB migrations)

**Responsibility**: Define identity hub, agent spoke, spoke edges, and migrate all record<person> fields.

**Boundary**: Migration scripts in `schema/migrations/`. Applied via `bun migrate`. No TypeScript logic.

**Stories**: US-UI-001 (hub schema), US-UI-003 (edge migration), US-UI-004 (auth fields), US-UI-006 (authority extensions)

**Integration points**:
- Consumed by: every component that reads/writes ownership fields
- Migration sequence number: 0017+ (after existing 0016)

---

### 2. Identity Bootstrap (workspace creation flow)

**Responsibility**: Wrap person records in identity hubs, register template agent identities, create spoke edges. Runs during workspace creation and as idempotent bootstrap.

**Boundary**: New module in `app/src/server/workspace/` or dedicated `app/src/server/identity/` directory. Called from workspace creation handler.

**Stories**: US-UI-002

**Integration points**:
- Depends on: workspace creation handler (`workspace-routes.ts`), person records, identity schema
- Produces: identity records, agent records, identity_person edges, identity_agent edges, member_of edges (now IN identity)
- Triggered by: workspace creation (automatic), manual bootstrap endpoint (idempotent)

---

### 3. IAM / Identity Resolution

**Responsibility**: Resolve authenticated users and agents to identity records. Replace person-based resolution with identity-based resolution.

**Boundary**: `app/src/server/iam/identity.ts` (existing file, modified)

**Stories**: US-UI-004

**Integration points**:
- `resolveIdentity()`: provider+providerId -> RecordId<"identity"> (was RecordId<"person">)
- `resolveByEmail()`: email -> RecordId<"identity"> (was RecordId<"person">)
- Resolution path: email -> person -> <-identity_person<-identity (one extra hop)
- Consumed by: auth config (better-auth adapter), chat ingress, MCP auth

---

### 4. Auth Adapter and Config

**Responsibility**: Bridge better-auth session/account models to identity-based references.

**Boundary**: `app/src/server/auth/adapter.ts` and `app/src/server/auth/config.ts`

**Stories**: US-UI-004

**Integration points**:
- better-auth `user` model still maps to `person` (for email-based signup/login)
- `session.userId` field maps to `identity_id` (was `person_id`)
- `account.userId` field maps to `identity_id` (was `person_id`)
- OAuth token claims: `customAccessTokenClaims` must resolve person -> identity for workspace membership query
- FK map in adapter needs to map `identity_id` -> `identity` table

---

### 5. Chat Context Pipeline

**Responsibility**: Build execution context for chat agent and subagents with identity-based actor reference.

**Boundary**: `app/src/server/chat/` (handler, ingress, processor, tools/types)

**Stories**: US-UI-004, US-UI-005

**Key type change**: `ChatToolExecutionContext.personRecord` -> `identityRecord: RecordId<"identity">`

**Integration points**:
- `chat-ingress.ts`: session -> identity_id -> identityRecord (was personRecord)
- `chat-processor.ts`: passes identityRecord through pipeline
- `handler.ts`: receives identityRecord, passes to tool context
- `tools/types.ts`: type definition change
- `workspaceOwnerRecord`: also changes from RecordId<"person"> to RecordId<"identity">
- `humanPresent` flag: derived from identity.type = 'human' (was implicit from session)

---

### 6. MCP Authentication

**Responsibility**: Resolve MCP agent connections to identity records.

**Boundary**: `app/src/server/mcp/auth.ts`, `app/src/server/mcp/types.ts`

**Stories**: US-UI-004

**Integration points**:
- `McpSessionContext.personRecord` -> `identityRecord: RecordId<"identity">`
- MCP auth resolves agent credentials to agent identity directly (no person intermediary)

---

### 7. Extraction Pipeline (Person/Identity Resolution)

**Responsibility**: Resolve assignee names and agent mentions to identity records during entity extraction.

**Boundary**: `app/src/server/extraction/person.ts` (rename to `identity-resolution.ts` or extend)

**Stories**: US-UI-003 (field type changes), US-UI-007 (agent mention resolution)

**Integration points**:
- `resolveWorkspacePerson()` -> `resolveWorkspaceIdentity()`: returns RecordId<"identity">
- `PersonAttributionPatch` -> `IdentityAttributionPatch`: field values are identity record references
- `findWorkspacePersonByName()` -> `findWorkspaceIdentityByName()`: searches identity.name instead of person.name
- US-UI-007: adds agent mention matching (role-based and name-based) with confidence threshold

---

### 8. Authority System

**Responsibility**: Check permissions for agent actions with role-based defaults and per-identity overrides.

**Boundary**: `app/src/server/iam/authority.ts`

**Stories**: US-UI-006

**Integration points**:
- `checkAuthority()` resolution order: authorized_to override -> role-based authority_scope -> agent_type authority_scope -> blocked
- Input changes: receives `identityRecord: RecordId<"identity">` in addition to agentType
- Human bypass: checks identity.type = 'human' instead of humanPresent flag (or both)

---

### 9. Audit Trail Queries

**Responsibility**: Dual-label attribution queries for entity detail and agent suggestion tracking.

**Boundary**: New query module in `app/src/server/graph/` and modifications to `chat/tools/get-entity-detail.ts`

**Stories**: US-UI-005

**Integration points**:
- Entity detail tool returns identity type context (human/agent) and managed_by chain
- New query: "agent suggestions that became tasks" with dual-label attribution
- Reusable helper: resolve managed_by chain from agent identity to accountable human

---

### 10. Graph Functions (SurrealQL)

**Responsibility**: Update stored SurrealQL functions that reference person in traversals.

**Boundary**: Schema migration or function redefinition in migration script.

**Stories**: US-UI-003

**Functions affected**:
- `fn::workspace_entity_ids`: `member_of` traversal changes from person to identity
- `fn::entity_edges`: `owns` traversal changes
- `fn::graph_neighbors`: same
- `fn::entity_neighbors`: person reference in entity union types
- `fn::entity_search_workspace`/`fn::entity_search_project`: no direct person reference (unaffected)

## Unchanged Components

| Component | Why unchanged |
|-----------|---------------|
| Extraction prompt + schema (`extraction/prompt.ts`, `extraction/schema.ts`) | Schema extracts entities by kind (task, decision, etc.), not by identity type. Assignee_name field is string -- resolution happens downstream. US-UI-007 (COULD) would add agent mentions to prompt. |
| PM agent (`agents/pm/`) | Consumes tool context, does not directly reference person records. Type change in ChatToolExecutionContext propagates automatically. |
| SSE registry (`streaming/sse-registry.ts`) | Message streaming, no identity references. |
| Document ingestion (`extraction/document-ingestion.ts`) | Chunks documents, no person/identity references. |
| Onboarding (`onboarding/`) | Uses workspace state, no direct person references in critical paths. |
