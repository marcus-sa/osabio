# Journey: Unified Audit Trail

## Persona
**Marcus** -- workspace owner, solo founder running an AI-native business management platform. Uses the chat UI to converse with agents, reviews knowledge graph for decisions and task attribution. Needs to evaluate AI ROI by tracking what agents did and whether their suggestions led to real outcomes.

## Emotional Arc
- **Start**: Frustrated/Blind -- "I know the PM agent did things, but I can't see them in the graph"
- **Middle**: Focused/Methodical -- migrating schema, seeing edges reconnect to identity nodes
- **End**: Confident/Empowered -- "Show me all suggestions made by agents that were actually implemented" returns real data

---

## Journey Flow

```
  [1. Schema Bootstrap]     [2. Identity Wrapping]     [3. Edge Migration]
  Create identity +         Wrap each person in        Repoint owns, member_of,
  person + agent spoke      identity hub node.         decided_by, owner to
  tables with hub-spoke     Create agent template      record<identity>.
  relationships.            identities.
        |                         |                          |
        v                         v                          v
  Emotional: Anxious         Emotional: Focused         Emotional: Methodical
  "Will this work?"          "Wrapping existing data"   "Lots of surface area"
        |                         |                          |
        +-------------------------+--------------------------+
                                  |
                                  v
  [4. Auth Rewiring]         [5. Authority Migration]    [6. Audit Query]
  Session + account          authority_scope gets         "Who touched this?"
  tables point at            role field on identity,      queries hit identity
  identity instead           override edges per           table, follow spoke
  of person.                 instance.                    for type-specific data.
        |                         |                          |
        v                         v                          v
  Emotional: Careful          Emotional: Deliberate      Emotional: Triumphant
  "Auth is critical path"    "Getting the role model    "It actually works --
                              right"                     I can see everything"
```

---

## Step Details

### Step 1: Schema Bootstrap -- Define Identity Hub + Spoke Tables

**Action**: Create SurrealDB migration defining `identity` (hub), modify `person` (spoke), create `agent` (spoke), and define spoke relation edges.

**What happens**:
```
+-- Schema Migration: 00XX_unified_identity.surql -------------------+
|                                                                     |
|  DEFINE TABLE identity SCHEMAFULL;                                  |
|  DEFINE FIELD name ON identity TYPE string;                         |
|  DEFINE FIELD type ON identity TYPE string                          |
|    ASSERT $value IN ['human', 'agent'];                             |
|  DEFINE FIELD role ON identity TYPE option<string>;                  |
|  DEFINE FIELD embedding ON identity TYPE option<array<float>>;       |
|  DEFINE FIELD workspace ON identity TYPE record<workspace>;          |
|  DEFINE FIELD created_at ON identity TYPE datetime;                  |
|                                                                     |
|  -- Spoke relation edges                                            |
|  DEFINE TABLE identity_person TYPE RELATION                         |
|    IN identity OUT person;                                          |
|  DEFINE TABLE identity_agent TYPE RELATION                          |
|    IN identity OUT agent;                                           |
|                                                                     |
|  -- Agent spoke table                                               |
|  DEFINE TABLE agent SCHEMAFULL;                                     |
|  DEFINE FIELD agent_type ON agent TYPE string;                       |
|  DEFINE FIELD model ON agent TYPE option<string>;                    |
|  DEFINE FIELD managed_by ON agent TYPE record<identity>;             |
|  ...                                                                |
+---------------------------------------------------------------------+
```

**Emotional state**: Anxious -> Cautious Optimism (schema is the easy part)

---

### Step 2: Identity Wrapping -- Wrap Existing Persons

**Action**: For each existing `person` record, create a corresponding `identity` record (type: 'human') and a spoke edge `identity -> person`. Create template agent identities for each known agent type in the workspace.

**What happens**:
```
+-- Before --------------------------+  +-- After ---------------------------+
|                                     |  |                                    |
|  person:marcus                      |  |  identity:marcus-human             |
|    name: "Marcus"                   |  |    name: "Marcus"                  |
|    contact_email: "marcus@..."      |  |    type: "human"                   |
|    identities: [{ provider: ... }]  |  |    role: "owner"                   |
|                                     |  |    workspace: workspace:ws1        |
|  (no agent identity exists)         |  |        |                           |
|                                     |  |        +-> person:marcus (spoke)   |
|                                     |  |              contact_email, image  |
|                                     |  |                                    |
|                                     |  |  identity:pm-agent-ws1             |
|                                     |  |    name: "PM Agent"                |
|                                     |  |    type: "agent"                   |
|                                     |  |    role: "management"              |
|                                     |  |        |                           |
|                                     |  |        +-> agent:pm-ws1 (spoke)    |
|                                     |  |              agent_type, model,    |
|                                     |  |              managed_by:           |
|                                     |  |                identity:marcus     |
+-------------------------------------+  +------------------------------------+
```

**Emotional state**: Focused -> Satisfied (data model is taking shape)

---

### Step 3: Edge Migration -- Repoint All Ownership and Attribution Edges

**Action**: Update `owns`, `member_of` relation tables. Change `owner`, `decided_by`, `confirmed_by`, `assigned_to` fields from `record<person>` to `record<identity>` across task, feature, decision, question tables.

**What happens**:
```
+-- Field Type Changes (schema migration) --------------------------+
|                                                                    |
|  task.owner:         record<person>  -->  record<identity>         |
|  feature.owner:      record<person>  -->  record<identity>         |
|  decision.decided_by:    record<person>  -->  record<identity>     |
|  decision.confirmed_by:  record<person>  -->  record<identity>     |
|  question.assigned_to:   record<person>  -->  record<identity>     |
|                                                                    |
|  -- Relation tables                                                |
|  owns:     IN person OUT ...  -->  IN identity OUT ...             |
|  member_of: IN person OUT workspace --> IN identity OUT workspace  |
|                                                                    |
+--------------------------------------------------------------------+

+-- Query Change Example -----------------------------------------+
|                                                                  |
|  BEFORE: SELECT * FROM task WHERE owner = person:marcus          |
|  AFTER:  SELECT * FROM task WHERE owner = identity:marcus-human  |
|                                                                  |
|  "Who touched this?" query:                                      |
|  SELECT *, ->identity_person->person AS human_detail,            |
|            ->identity_agent->agent AS agent_detail                |
|  FROM identity                                                   |
|  WHERE <-owns<-task CONTAINS task:t123;                          |
+------------------------------------------------------------------+
```

**Emotional state**: Methodical -> Relieved (the largest surface area change, but project has no backwards compat requirement so it's clean)

---

### Step 4: Auth Rewiring -- Session and Account Tables

**Action**: Change `session.person_id` and `account.person_id` from `record<person>` to `record<identity>`. Update `iam/identity.ts` resolution functions to return `RecordId<"identity">`.

**What happens**:
```
+-- Auth Flow Change ------------------------------------------------+
|                                                                     |
|  BEFORE:                                                            |
|  OAuth callback -> resolve email -> person:marcus -> session        |
|                                                                     |
|  AFTER:                                                             |
|  OAuth callback -> resolve email -> identity:marcus-human           |
|                    (via person spoke lookup) -> session              |
|                                                                     |
|  identity.ts changes:                                               |
|    resolveIdentity():  RecordId<"person"> --> RecordId<"identity">  |
|    resolveByEmail():   RecordId<"person"> --> RecordId<"identity">  |
|                                                                     |
+---------------------------------------------------------------------+
```

**Emotional state**: Careful -> Confident (auth is critical path, but the change is mechanical)

---

### Step 5: Authority Migration -- Role-Based with Overrides

**Action**: Add `role` field to `identity` table. Modify `authority_scope` to match on role instead of (or in addition to) `agent_type` string. Add optional per-identity override edges.

**What happens**:
```
+-- Authority Resolution Chain --------------------------------------+
|                                                                     |
|  1. Check per-identity override:                                    |
|     SELECT permission FROM authorized_to                            |
|     WHERE in = $identity AND action = $action;                      |
|                                                                     |
|  2. Check role-based default:                                       |
|     LET $role = (SELECT role FROM $identity);                       |
|     SELECT permission FROM authority_scope                          |
|     WHERE role = $role AND action = $action;                        |
|                                                                     |
|  3. Fail-safe: no match = blocked                                   |
|                                                                     |
|  Example:                                                           |
|  identity:pm-agent-ws1 { role: "management" }                       |
|    -> authority_scope { role: "management", action: "create_task",   |
|                         permission: "auto" }                        |
|    -> Override: authorized_to edge grants "confirm_decision: auto"  |
|       (normally "provisional" for management role)                  |
+---------------------------------------------------------------------+
```

**Emotional state**: Deliberate -> Assured (the permission model is clean and auditable)

---

### Step 6: The First Query -- Evaluating AI ROI

**Action**: Marcus runs the query he's been wanting: "Show me all suggestions made by agents that were actually implemented."

**What happens**:
```
+-- The Query Marcus Has Been Waiting For ---------------------------+
|                                                                     |
|  SELECT                                                             |
|    suggestion.summary,                                              |
|    creator.name AS suggested_by,                                    |
|    creator.type AS actor_type,                                      |
|    manager.name AS accountable_human,                               |
|    implemented_task.title AS became_task,                            |
|    implemented_task.status                                          |
|  FROM suggestion                                                    |
|  WHERE <-created_by<-identity.type = 'agent'                        |
|    AND ->led_to->task.status IN ['done', 'completed']               |
|  FETCH creator, manager, implemented_task;                          |
|                                                                     |
|  Result:                                                            |
|  +----------------------------------------------------------+      |
|  | Suggestion       | By         | Acct.    | Task    | St. |      |
|  |------------------|------------|----------|---------|-----|      |
|  | Prioritize auth  | PM Agent   | Marcus   | US-042  | done|      |
|  | Add pagination   | PM Agent   | Marcus   | US-051  | ip  |      |
|  | Schema migration | Code Agent | Marcus   | US-033  | done|      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  "3 of 7 agent suggestions became completed tasks. 43% ROI."       |
+---------------------------------------------------------------------+
```

**Emotional state**: Triumphant -> Empowered ("This was worth it. I can see the full picture.")

---

## Integration Checkpoints

| Checkpoint | Between Steps | Validates |
|------------|---------------|-----------|
| IC-1 | 1 -> 2 | Identity table exists, spoke edges defined, before wrapping begins |
| IC-2 | 2 -> 3 | Every person has a wrapping identity, all agent templates created |
| IC-3 | 3 -> 4 | All `record<person>` fields changed to `record<identity>`, relation tables updated |
| IC-4 | 4 -> 5 | Auth flow works end-to-end with identity records (login, session, OAuth) |
| IC-5 | 5 -> 6 | Authority checks pass with role-based lookup + override edges |

## Shared Artifacts

| Artifact | Source | Consumers | Risk |
|----------|--------|-----------|------|
| `identity.type` enum values | Schema migration (identity table ASSERT) | Authority checks, extraction pipeline, UI rendering, audit queries | HIGH -- enum mismatch breaks identity classification |
| `identity.role` values | Seed data + workspace bootstrap | authority_scope lookups, per-identity overrides | HIGH -- role mismatch breaks authorization |
| `managed_by` edge | agent spoke table field | Audit trail dual-label rendering, accountability chain queries | MEDIUM -- broken edge breaks accountability |
| `RecordId<"identity">` type | TypeScript types after migration | Every file that previously used `RecordId<"person">` for ownership | HIGH -- type mismatch = compile errors everywhere |
