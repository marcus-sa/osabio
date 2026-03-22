# Shared Artifacts Registry -- Tool Registry UI

## Artifacts

### credential_provider[]

- **Source of truth**: `GET /api/workspaces/:ws/integrations/providers` (backend)
- **Consumers**: Providers tab (list), Add Provider dialog (duplicate check), Connect dialogs (auth_method determines form), Tools tab (provider name column)
- **Owner**: Providers tab
- **Integration risk**: MEDIUM -- provider list shown in both admin and member views; auth_method drives form adaptation in connect dialogs
- **Validation**: Provider name unique per workspace; auth_method determines which form fields render

### mcp_tool[]

- **Source of truth**: `GET /api/workspaces/:ws/integrations/tools` (backend)
- **Consumers**: Tools tab (grouped list), Access tab (tool picker for grants), Governance attachment dialog
- **Owner**: Tools tab
- **Integration risk**: LOW -- read-only display; grant_count subquery returns current count
- **Validation**: Grant count in Tools tab must reflect actual can_use edge count

### connected_account[]

- **Source of truth**: `GET /api/workspaces/:ws/integrations/accounts` (backend)
- **Consumers**: Accounts tab (dashboard), Providers tab (connection status per provider)
- **Owner**: Accounts tab
- **Integration risk**: HIGH -- status must sync between Providers tab and Accounts tab; revoke action permanently deletes credentials
- **Validation**: After revoke, both Providers tab and Accounts tab must show updated status without page reload

### can_use edges

- **Source of truth**: `POST/DELETE /api/workspaces/:ws/integrations/tools/:id/grants` (backend)
- **Consumers**: Access tab (grant list per tool), Tools tab (grant_count column), Effective toolset view per identity
- **Owner**: Access tab
- **Integration risk**: MEDIUM -- grant_count in Tools tab must update after creating/removing grants
- **Validation**: Creating a can_use edge increments grant_count; removing decrements

### governs_tool edges

- **Source of truth**: `POST /api/workspaces/:ws/integrations/tools/:id/governance` (backend)
- **Consumers**: Tools tab (governance indicator)
- **Owner**: Tools tab (governance dialog)
- **Integration risk**: LOW -- read-only policy reference
- **Validation**: Attached policy name visible on tool detail

### identity[]

- **Source of truth**: Workspace identity list (existing Brain API)
- **Consumers**: Access tab (identity picker for grants), Effective toolset view
- **Owner**: IAM subsystem (external to this feature)
- **Integration risk**: LOW -- read-only consumption
- **Validation**: Identity picker shows all workspace identities

### policy[]

- **Source of truth**: Existing policies API (`GET /api/workspaces/:ws/policies`)
- **Consumers**: Governance attachment dialog (policy picker)
- **Owner**: Policies subsystem (external to this feature)
- **Integration risk**: LOW -- read-only consumption
- **Validation**: Only active policies appear in picker

## Cross-Tab Consistency Requirements

| Artifact | Tab A | Tab B | Sync Requirement |
|----------|-------|-------|-----------------|
| connected_account.status | Providers | Accounts | Both must show same status; revoke/reconnect in either tab updates both |
| mcp_tool[].grant_count | Tools | Access | Grant count updates after grant/revoke without full page reload |
| credential_provider[] | Providers | Tools (provider column) | Provider name in tool list must match provider registry |

## Data Freshness Strategy

All tabs fetch data on mount. After mutations (create provider, connect account, grant access, revoke), the affected tab invalidates its cache and refetches. Cross-tab consistency is achieved through React Query cache invalidation -- mutations invalidate related query keys.
