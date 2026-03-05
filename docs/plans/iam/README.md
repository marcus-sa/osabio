# IAM: Unified Auth Layer

## What IAM Solves

Without IAM, the platform has N disconnected identity silos:

- "Marcus" in a web chat conversation
- `marcus-dk` in a GitHub commit
- `U12345` in a Slack thread
- `marcus@example.com` in a calendar invite
- `api_key:xyz` authenticating a coding agent via MCP

These are all the same person. Without a resolution layer, the graph can't answer "show me everything Marcus did this week" because it doesn't know these are the same entity. And it can't answer "does this agent have permission to confirm this decision?" because there's no authority model linking agents to people.

IAM is two things:

1. **Identity resolution** — one Person node, many external identities
2. **Authority model** — who (human or agent) can do what, and under what conditions

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| [Phase 1: MVP](phase-1.md) | Basic identity, API key for dogfooding, OAuth-ready architecture | In progress |
| [Phase 2: Pre-Early Access](phase-2.md) | Proper OAuth 2.1 for agents, multi-source identity, configurable authority | Not started |
| [Phase 3: Teams](phase-3.md) | Multi-user workspaces with role-based access | Not started |

## Core Concepts

### Person Entity

```
Person {
  kind: "person"
  name: string
  role?: string
  contact_info?: { email?, phone? }
  identities: Identity[]

  // Relationships
  // MEMBER_OF → Workspace (role: "owner" | "member")
  // OWNS → Task, Feature, Project
  // DECIDED_BY → Decision (reverse)
}

Identity {
  provider: string        // "platform" | "github" | "slack" | "google" | "linear" | "mcp"
  provider_id: string     // the ID in that system
  display_name?: string
  email?: string
  linked_at: datetime
  oauth_token?: string    // encrypted
  refresh_token?: string  // encrypted
  token_expires_at?: datetime
}
```

**Critical rule:** Person nodes are never created by extraction. Only through explicit actions: workspace creation (owner), OAuth connection, or manual invite.

### Two Agent Auth Patterns

**Platform-managed agents** — agents the platform spawns and controls (Architect, Observer, PM). First-class actors with their own identity. Act on behalf of the *workspace*, not a specific person.

**User-local agents** — Claude Code, Cursor, Aider on your laptop. Authenticate as *you* with restricted scope. The agent is an extension of you, not an autonomous actor.

### Identity Resolution Chain

```
1. Exact provider match → direct match
2. Email match (cross-provider) → match via shared email
3. Display name fuzzy match → candidate, surface as suggestion (Phase 2)
4. No match → store as unresolved reference
```

## How IAM Connects to Everything Else

**Extraction pipeline:** Resolves person references in chat/commits/Slack to Person nodes. Never creates Person nodes — only links or flags unresolved.

**MCP server:** Validates token → resolves workspace → checks authority scope for each tool call.

**Git hooks:** Post-commit resolves commit author to Person via email. Pre-commit checks authority.

**Feed:** Authority scope changes surface as feed items. Agent approval/rejection rates shown per agent type.

**Agent Coordinator (Phase 4-5):** Routes observations to agents based on authority scope.
