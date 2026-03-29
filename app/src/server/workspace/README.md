# Workspace

Workspace lifecycle — creation, identity bootstrapping, repo path validation, conversation sidebar, and configuration management.

## The Problem

A workspace is the top-level container for everything in Osabio — projects, decisions, tasks, conversations, and agent sessions all belong to a workspace. Creating one requires bootstrapping identity records, validating repo paths, initializing conversations, and setting up onboarding state. The workspace module handles this lifecycle and provides efficient data loading for the UI sidebar.

## What It Does

- **Workspace creation**: Creates workspace record with identity bootstrap (current user + default bot identity)
- **Repo path validation**: Verifies git repository paths exist and are reachable via shell exec
- **Conversation sidebar**: Builds the message tree with parent links for the sidebar navigation
- **Conversation history**: Loads conversation messages with branch inheritance
- **Onboarding tracking**: Manages onboarding state (completion, turn count) per workspace

## Key Concepts

| Term | Definition |
|------|------------|
| **Workspace** | Top-level container with name, description, repo_path, and onboarding state |
| **Identity Bootstrap** | Creates `person`, `identity`, `identity_person`, and `member_of` records for the workspace creator |
| **Repo Path** | Filesystem path to the git repository this workspace tracks — validated for existence |
| **Conversation Sidebar** | Tree of conversation messages with parent references for UI navigation |
| **Onboarding State** | Tracks whether the workspace has completed guided setup (active → complete) |

## How It Works

**Workspace creation:**

1. `POST /api/workspaces` with `{ name, description, repoPath }`
2. Create `workspace` record in SurrealDB
3. Identity bootstrap:
   - Create `person` record for the user
   - Create `identity` record linked to OAuth provider
   - Create `identity_person` edge
   - Create `member_of` edge (identity → workspace) with `owner` role
   - Create default `bot` identity for agent use
4. Validate repo path (if provided) — shell exec `git -C <path> rev-parse`
5. Initialize onboarding state: `active`
6. Return workspace ID + initial conversation

**Sidebar loading:**

1. `GET /api/workspaces/:id/sidebar`
2. Load all conversations for workspace
3. Build parent-child tree from message references
4. Return nested conversation list with metadata (last message time, message count)

## Where It Fits

```text
User creates workspace
  |
  v
POST /api/workspaces
  +---> Create workspace record
  +---> Identity bootstrap
  |       +-> person + identity + edges
  |       +-> member_of (owner role)
  |       +-> bot identity (for agents)
  +---> Validate repo path
  +---> Initialize onboarding
  |
  v
Workspace ready
  +---> Conversations (sidebar)
  +---> Projects, tasks, decisions (graph)
  +---> Agent sessions (orchestrator)
```

**Consumes**: User identity, repo paths, workspace configuration
**Produces**: Workspace records, identity graphs, conversation trees

## File Structure

```text
workspace/
  workspace-routes.ts       # HTTP handlers: create, bootstrap, sidebar, conversation, repo update
  identity-bootstrap.ts     # Seed person + identity + member_of records for workspace creator
  conversation-sidebar.ts   # Build message tree for sidebar navigation
  validate-repo-path.ts     # Shell exec git validation for repository paths
```
