# Unified Identity: Data Models

## New Tables

### identity (hub)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| name | string | yes | Display name |
| type | string | yes | ASSERT IN ['human', 'agent', 'system'] |
| role | option\<string\> | no | Functional role: owner, management, coder, observer, etc. |
| workspace | record\<workspace\> | yes | Scoped to workspace |
| embedding | option\<array\<float\>\> | no | HNSW 1536-dim for vector search |
| created_at | datetime | yes | |

**Indexes**:
- `identity_workspace` on `workspace`
- `identity_type_workspace` on `type, workspace`
- `idx_identity_embedding` HNSW DIMENSION 1536 DIST COSINE on `embedding`

**KNN+WHERE workaround** (required because `identity_workspace` B-tree index conflicts with HNSW in same query):
```sql
-- BROKEN: KNN + WHERE with B-tree indexed field
SELECT *, vector::similarity::cosine(embedding, $vec) AS similarity
FROM identity WHERE workspace = $ws AND embedding <|K, COSINE|> $vec;

-- CORRECT: split into LET + filter
LET $candidates = SELECT *, vector::similarity::cosine(embedding, $vec) AS similarity, workspace
FROM identity WHERE embedding <|K, COSINE|> $vec;
SELECT * FROM $candidates WHERE workspace = $ws ORDER BY similarity DESC LIMIT $limit;
```

### agent (spoke)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| agent_type | string | yes | Matches authority_scope enum: code_agent, architect, management, design_partner, observer |
| model | option\<string\> | no | LLM model identifier |
| managed_by | record\<identity\> | yes | Human identity responsible for this agent. Must reference identity with type='human' — circular or agent-to-agent managed_by chains rejected at bootstrap creation time |
| created_at | datetime | yes | |

### identity_person (spoke edge)

| Constraint | Value |
|------------|-------|
| TYPE RELATION | IN identity OUT person |
| added_at | datetime |

### identity_agent (spoke edge)

| Constraint | Value |
|------------|-------|
| TYPE RELATION | IN identity OUT agent |
| added_at | datetime |

## Modified Tables

### Fields changing from record\<person\> to record\<identity\>

| Table | Field | Before | After |
|-------|-------|--------|-------|
| task | owner | option\<record\<person\>\> | option\<record\<identity\>\> |
| feature | owner | option\<record\<person\>\> | option\<record\<identity\>\> |
| decision | decided_by | option\<record\<person\>\> | option\<record\<identity\>\> |
| decision | confirmed_by | option\<record\<person\>\> | option\<record\<identity\>\> |
| question | assigned_to | option\<record\<person\>\> | option\<record\<identity\>\> |
| observation | resolved_by | option\<record\<person\>\> | option\<record\<identity\>\> |
| git_commit | author | option\<record\<person\>\> | option\<record\<identity\>\> |
| pull_request | author | option\<record\<person\>\> | option\<record\<identity\>\> |
| session | person_id | record\<person\> | REMOVE; add identity_id record\<identity\> |
| account | person_id | record\<person\> | REMOVE; add identity_id record\<identity\> |

### Relation tables changing IN constraint

| Table | Before | After |
|-------|--------|-------|
| owns | IN person OUT task \| project \| feature | IN identity OUT task \| project \| feature |
| member_of | IN person OUT workspace | IN identity OUT workspace |
| attended_by | IN meeting OUT person | IN meeting OUT identity |

### person table modifications

| Change | Detail |
|--------|--------|
| REMOVE FIELD | `identities` (redundant with account table) |
| No other changes | person retains name, role, contact_email, contact_phone, email_verified, image, embedding, created_at, updated_at |

### OAuth tables (better-auth managed)

| Table | Field | Before | After |
|-------|-------|--------|-------|
| oauthClient | userId | option\<record\<person\>\> | option\<record\<identity\>\> |
| oauthAccessToken | userId | option\<record\<person\>\> | option\<record\<identity\>\> |
| oauthRefreshToken | userId | option\<record\<person\>\> | option\<record\<identity\>\> |
| oauthConsent | userId | option\<record\<person\>\> | option\<record\<identity\>\> |

## US-UI-006: Authority Model Extensions

### authority_scope modifications

| Change | Detail |
|--------|--------|
| Add field | `role` option\<string\> -- matches identity.role for role-based lookup |
| Retain | `agent_type` field for backwards compatibility during transition |
| New index | `authority_scope_role_lookup` on role, action, workspace UNIQUE |

### authorized_to (new relation -- per-identity override)

| Constraint | Value |
|------------|-------|
| TYPE RELATION | IN identity OUT authority_scope |
| permission | string ASSERT IN ['auto', 'provisional', 'propose', 'blocked'] |
| created_at | datetime |

## Graph Traversal Patterns

### Identity resolution (email -> identity)

```
person(contact_email) -> <-identity_person<-identity
```

### Managed-by chain (agent -> accountable human)

```
identity(type=agent) -> identity_agent -> agent.managed_by -> identity(type=human)
```

### Dual-label audit (who did this + who is accountable)

```
task.owner -> identity {
  type = 'human': self is accountable
  type = 'agent': ->identity_agent->agent.managed_by -> identity(type=human)
}
```

## Extraction Pipeline Impact

### Current: person resolution

```
extraction schema -> assignee_name -> resolveWorkspacePerson() -> RecordId<"person">
```

### After: identity resolution

```
extraction schema -> assignee_name -> resolveWorkspaceIdentity() -> RecordId<"identity">
```

Resolution order: exact name match on identity.name (workspace-scoped) -> email match via person spoke -> undefined.

### US-UI-007: Agent mention resolution (COULD)

```
extraction schema -> assignee_name -> resolveWorkspaceIdentity() {
  1. match identity WHERE type = 'human' AND name match
  2. match identity WHERE type = 'agent' AND name match
  3. match identity WHERE type = 'agent' AND ->identity_agent->agent.agent_type match
  4. email fallback via person spoke
}
```
