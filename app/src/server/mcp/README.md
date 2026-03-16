# MCP

Model Context Protocol server — authenticates coding agents via DPoP, provides workspace/project/task context, and handles intent and observation operations.

## The Problem

External coding agents (Claude Code, Cursor, Aider) need access to the knowledge graph. They need to know what decisions have been made, what tasks are assigned, what constraints exist — and they need to write back observations, suggestions, and intent requests. The MCP module is the authenticated API surface that bridges coding agents to the Brain graph.

## What It Does

- **DPoP authentication**: Validates Demonstration of Proof-of-Possession tokens with single-use proofs per request
- **Context packets**: Builds workspace, project, or task-scoped context with decisions, tasks, questions, and observations
- **Intent operations**: Creates intents and triggers evaluation for agent action authorization
- **Observation/suggestion creation**: Agents write findings back to the graph
- **Commit checking**: Parses git commit messages for task references (`task:xxx`) and creates completion intents
- **ID format validation**: Enforces strict wire format — raw IDs for fixed-table fields, `table:id` for polymorphic fields

## Key Concepts

| Term | Definition |
|------|------------|
| **DPoP Token** | OAuth 2.0 access token bound to a specific key pair — proof JWT sent with each request |
| **Context Packet** | Bundle of decisions (confirmed/provisional/contested), tasks, questions, observations, suggestions |
| **Workspace Binding** | DPoP token contains `urn:brain:workspace` claim — middleware extracts workspace from JWT, not URL path |
| **mcpFetch** | Client-side helper that creates a fresh DPoP proof per request (proofs are single-use) |
| **Commit Check** | Regex extraction of `task:abc123` or `tasks: abc, def` from commit messages |

## How It Works

**Example — coding agent loads project context:**

1. Agent starts session → `brain init` acquired DPoP-bound token with workspace claim
2. Agent calls `POST /api/mcp/:workspaceId/context` with `{ project: "rate-limiting" }`
3. DPoP middleware: extract token → verify signature → validate proof → check replay → lookup workspace
4. `context-builder.ts` builds packet:
   - Confirmed decisions for project (e.g. "Use token bucket algorithm")
   - Open tasks (e.g. "Implement rate limiter middleware")
   - Pending questions (e.g. "Should we rate-limit per user or per API key?")
   - Open observations (e.g. "Current implementation has no rate limiting")
5. Returns `ContextPacket` — agent uses it to understand scope before coding

**Commit task reference flow:**

1. Agent commits: `"Implement rate limiter middleware\n\ntask:abc123"`
2. `commit-check.ts` parses → extracts `abc123` as task reference
3. Creates task completion intent → flows through intent evaluation

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Workspace mismatch** | Token claim workspace != URL workspace → 403 |
| **Missing member_of edge** | No `member_of` relation → 401 "Workspace not found" |
| **Stale DPoP proof** | Proofs are single-use; reuse → replay detection → 401 |
| **Polymorphic ID without table** | Rejected with validation error for fields requiring `table:id` format |
| **Task-scoped context** | Returns task + subtasks + parent + dependencies + siblings |

## Where It Fits

```text
Coding Agent (Claude Code, Cursor, Aider)
  |
  +---> brain init (OAuth 2.1 + PKCE + DPoP)
  |
  v
POST /api/mcp/:workspaceId/context
  |
  +---> DPoP Middleware (8-step verification)
  |       +-> extract auth -> verify token -> validate proof
  |       +-> verify binding -> check replay -> lookup workspace
  |
  +---> Context Builder
  |       +-> buildWorkspaceOverview() | buildProjectContext() | buildTaskContext()
  |       +-> Returns ContextPacket
  |
  +---> Intent Operations
  |       +-> POST /intents (create)
  |       +-> POST /intents/:id/check (evaluate)
  |
  +---> Observation/Suggestion Operations
          +-> POST /observations (create)
          +-> POST /suggestions (create)
```

**Consumes**: DPoP tokens, workspace/project/task identifiers
**Produces**: Context packets, intent records, observations, suggestions

## File Structure

```text
mcp/
  mcp-route.ts          # HTTP endpoints: context, intents, observations, suggestions (~800 lines)
  mcp-dpop-auth.ts      # DPoP token validation middleware
  context-builder.ts    # Build workspace/project/task context packets
  mcp-queries.ts        # Graph queries for MCP-specific data loading
  intent-context.ts     # Resolve intent + policy trace for evaluation
  commit-check.ts       # Parse git commit messages for task references
  id-format.ts          # ID wire format validation (raw vs table:id)
  auth.ts               # Auth helpers for MCP endpoints
  token-validation.ts   # JWT/JWKS validation for OAuth tokens
  types.ts              # McpRequestContext, McpAuthResult, ContextPacket
```
