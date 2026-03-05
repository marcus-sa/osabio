# IAM Phase 1: MVP — Ship Now

**Goal:** Basic identity that doesn't block anything else. API key for dogfooding, OAuth-ready architecture.

**Status:** In progress — better-auth + SurrealDB adapter shipped (PR #98).

## What's Done

- [x] Person table evolved with auth fields (`contact_email`, `email_verified`, `image`, `updated_at`)
- [x] better-auth integrated with custom SurrealDB v2 adapter
- [x] GitHub OAuth provider configured (sign-in redirect, account linking)
- [x] Session, account, verification tables created
- [x] Account linking works (existing person + new OAuth provider)
- [x] 17 integration tests passing

## What's Left

### Identity Resolution (exact match only)

Resolve external identifiers to Person nodes via two strategies:

1. **Exact provider match** — `account.provider_id == id AND account.provider_id == provider`
2. **Email match (cross-provider)** — `person.contact_email == email`

No fuzzy matching in Phase 1. Unresolved names stored as string attributes on entities.

```sql
-- Resolve an external identity to a Person
DEFINE FUNCTION fn::resolve_identity($provider: string, $provider_id: string) {
  LET $person = SELECT * FROM person
    WHERE identities[WHERE provider = $provider AND provider_id = $provider_id];

  IF array::len($person) > 0 {
    RETURN $person[0];
  };

  RETURN NONE;
};

-- Resolve by email (cross-provider)
DEFINE FUNCTION fn::resolve_by_email($email: string) {
  LET $by_identity = SELECT * FROM person
    WHERE identities[WHERE email = $email];

  IF array::len($by_identity) > 0 {
    RETURN $by_identity[0];
  };

  LET $by_contact = SELECT * FROM person
    WHERE contact_info.email = $email;

  IF array::len($by_contact) > 0 {
    RETURN $by_contact[0];
  };

  RETURN NONE;
};
```

### MCP Auth (API key — dogfooding only)

Simple API key that maps to workspace + fixed scopes matching the default authority table. The MCP server's authorization layer validates scopes the same way whether they come from an API key or an OAuth token. Swapping to OAuth later means changing token validation, not rewriting authorization.

### Authority Scopes (hardcoded defaults)

Hardcoded defaults per agent type. Not configurable yet — just enforced.

| Action | Code Agent | Architect | Management | Design Partner | Observer |
|--------|-----------|-----------|------------|----------------|----------|
| create_decision | provisional | provisional | provisional | provisional | blocked |
| confirm_decision | blocked | blocked* | blocked | blocked | blocked |
| create_task | auto | auto | auto | provisional | blocked |
| complete_task | auto | blocked | auto | blocked | blocked |
| create_subtask | auto | blocked | blocked | blocked | blocked |
| create_observation | auto | auto | auto | auto | auto |
| ask_question | auto | auto | auto | auto | blocked |
| modify_feature | blocked | propose | propose | propose | blocked |
| modify_project | blocked | propose | propose | blocked | blocked |

Permission levels: **auto** (done, shown in feed), **provisional** (done as draft, needs review), **propose** (proposed, needs approval), **blocked** (cannot do).

```sql
-- Check if an agent action is allowed
DEFINE FUNCTION fn::check_authority($agent_type: string, $workspace: record<workspace>, $action: string) {
  LET $scope = SELECT * FROM authority_scope
    WHERE agent_type = $agent_type AND workspace = $workspace;

  IF array::len($scope) == 0 {
    RETURN "provisional";
  };

  LET $permission = $scope[0].actions[$action];

  IF $permission == NONE {
    RETURN "blocked";
  };

  RETURN $permission;
};
```

### Schema additions

```sql
-- Authority scopes
DEFINE TABLE authority_scope SCHEMAFULL;
DEFINE FIELD agent_type ON authority_scope TYPE string;
DEFINE FIELD workspace ON authority_scope TYPE record<workspace>;
DEFINE FIELD actions ON authority_scope TYPE object;
DEFINE FIELD constraints ON authority_scope TYPE option<object>;

-- Workspace permissions (owner-only for now)
DEFINE TABLE workspace_permission SCHEMAFULL;
DEFINE FIELD person ON workspace_permission TYPE record<person>;
DEFINE FIELD workspace ON workspace_permission TYPE record<workspace>;
DEFINE FIELD role ON workspace_permission TYPE string
  ASSERT $value IN ["owner", "admin", "member", "viewer"];
DEFINE FIELD project_access ON workspace_permission TYPE option<array<object>>;
```

### Platform-Managed Agent Auth

`human_present` flag on web chat sessions. Chat agent can confirm decisions (human is live approval mechanism). Coding agent cannot.

```
AgentIdentity {
  agent_id: string             // "architect:ws:xyz"
  agent_type: string           // "architect" | "management" | "design-partner" | "observer"
  workspace: string
  authenticated_via: "platform"
  human_present: boolean       // true for web chat, false for background
}
```

### Web Chat Authentication

Web chat agents authenticate via the user's browser session (session cookie from better-auth). Human is always present → `human_present: true`. The chat agent inherits the user's session permissions.

### Extraction Pipeline — Name Resolution

Extraction resolves names against existing Person nodes. Unresolved names stored as string attributes (`decided_by_name: "Sarah"`), suggestion surfaced in feed.

**Critical rule:** Person nodes are never created by extraction. Only through explicit actions: workspace creation, OAuth connection, or manual invite.

### GitHub OAuth Connection Flow

```
1. Human clicks "Connect GitHub" in workspace settings
2. OAuth redirect → GitHub authorizes → callback with user ID + email + username
3. System checks:
   a. GitHub email matches existing Person? → auto-link (better-auth handles this)
   b. No match? → link to currently logged-in Person
4. Account record created with provider_id: "github", account_id: GitHub user ID
5. OAuth tokens stored for API access
```

## What This Unblocks

- Git commit attribution (post-commit hook → resolve author email → link to Person)
- MCP tool authorization (coding agent can't confirm decisions)
- Cross-source queries ("show me Marcus's commits and decisions this week")
