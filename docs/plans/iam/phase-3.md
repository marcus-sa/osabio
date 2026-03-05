# IAM Phase 3: Teams

**Goal:** Multi-user workspaces with role-based access.

**Status:** Not started. Depends on Phase 2 completion.

## Workspace Invitation Flow

Invite by email → creates Person node with `role: "member"`. OAuth connection links their external identities.

## Role-Based Permissions

```
WorkspacePermission {
  person: Person
  workspace: Workspace
  role: "owner" | "admin" | "member" | "viewer"

  // Granular overrides (optional)
  project_access?: {
    project_id: string
    level: "full" | "read" | "none"
  }[]
}
```

| Capability | Owner | Admin | Member | Viewer |
|------------|-------|-------|--------|--------|
| Manage workspace settings | yes | yes | | |
| Connect OAuth providers | yes | yes | | |
| Create/manage API keys | yes | yes | | |
| Configure agent authority scopes | yes | yes | | |
| Create projects/features | yes | yes | yes | |
| Confirm decisions | yes | yes | yes | |
| View graph/feed | yes | yes | yes | yes |
| Invite members | yes | yes | | |

## Per-Project Access Controls

Some projects visible to some team members. Granular `project_access` overrides on workspace permission.

## Per-Person OAuth Clients

Agent sessions linked to the human who authorized them. Each person's coding agent authenticates as them — graph writes attributed to their Person node.

## Source-Scoped Visibility

If you can't see a Slack channel, you can't see graph nodes extracted from it. Visibility follows the source permission model.

## Audit Log

- Who authorized what agent, which scopes, when
- Who changed authority scopes
- Who confirmed/rejected which decisions
- Agent approval/rejection rates per person

## Future: Platform-Launched Autonomous Coding Agents (Phase 4-5)

Eventually, the platform might spawn coding agents without a human at the keyboard — e.g., feed shows a task, you click "assign to agent," platform launches a Claude Code session in the cloud.

These need:

- Their own OAuth client (registered by platform on launch)
- `initiated_by: person:marcus` (the human who clicked "assign to agent")
- Scopes matching coding agent defaults (no `decision:confirm`)
- `human_present: false`
- AgentSession attributed to both the agent and the initiating person
