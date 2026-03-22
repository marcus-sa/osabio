# Story Map: Tool Registry UI

## User: Priya Sharma (Workspace Admin) + Carlos Mendez (Workspace Member)
## Goal: Manage integration tools, providers, accounts, and access through a web UI

## Backbone

| Navigate | Browse Tools | Manage Providers | Connect Accounts | Manage Access | Govern Tools | Discover Tools |
|----------|-------------|-----------------|-----------------|---------------|-------------|---------------|
| Route + sidebar nav | List/filter/group tools | Register/edit providers | OAuth2 + static flows | Grant can_use edges | Attach policies | MCP server discovery |
| Empty state | Search tools | Adaptive forms | Connected accounts dashboard | View effective toolset | Rate limits | Review before import |
| Tab navigation | | Delete provider | Revoke/reconnect | Remove grants | | |

---

### Walking Skeleton

The thinnest end-to-end slice that connects all activities:

1. **Navigate**: Route `/tools` with sidebar nav entry + tab shell (Tools, Providers, Accounts, Access)
2. **Browse Tools**: Read-only tool list grouped by toolkit (no filters yet)
3. **Manage Providers**: Register provider dialog with auth_method adaptation
4. **Connect Accounts**: Connect button with static credential form (api_key only)
5. **Manage Access**: Grant dialog with identity picker
6. **Govern Tools**: Deferred (not in walking skeleton -- governance already works via Policies page)
7. **Discover Tools**: Deferred (not in walking skeleton -- US-2 backend not in scope)

Walking skeleton delivers: admin can register a provider, member can connect an account, admin can grant tool access, and both can browse the resulting tools.

### Release 1: Core CRUD (outcome: admin can fully set up integrations via UI)

- Filter tools by status and risk_level
- Search tools by name
- OAuth2 connection flow (redirect + callback)
- Connected accounts dashboard with revoke action
- Basic auth and bearer token connection forms
- Delete/edit provider

### Release 2: Access Governance (outcome: admin has full visibility and control over tool access)

- View effective toolset per identity (direct + skill-derived)
- Remove grant (revoke can_use edge)
- Attach governance policy to tool
- Rate limit display and configuration

### Release 3: Discovery (outcome: admin can import tools from external MCP servers)

- MCP server connection dialog
- Tool discovery review screen
- Selective import with risk_level suggestions

## Scope Assessment: PASS -- 8 stories, 2 contexts (tool-registry UI, existing Brain APIs), estimated 8-12 days
