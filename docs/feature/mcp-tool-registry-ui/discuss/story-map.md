# Story Map: Tool Registry UI

## User: Priya Sharma (Workspace Admin) + Carlos Mendez (Workspace Member)
## Goal: Manage integration tools, providers, accounts, and access through a web UI -- and have those tools actually work when agents use them

## Backbone

| Navigate | Browse Tools | Manage Providers | Connect Accounts | Manage Access | Govern Tools | Connect Servers | Discover Tools | Execute Tools |
|----------|-------------|-----------------|-----------------|---------------|-------------|----------------|---------------|---------------|
| Route + sidebar nav | List/filter/group tools | Register/edit providers | OAuth2 + static flows | Grant can_use edges | Attach policies | MCP server CRUD | tools/list discovery | Proxy step 9 execution |
| Empty state | Search tools | Adaptive forms | Connected accounts dashboard | View effective toolset | Rate limits | Transport auto-detect | Review + selective import | Multi-turn tool loop |
| Tab navigation | Tool provenance badges | Delete provider | Revoke/reconnect | Remove grants | | Credential injection | Re-sync with diff | Credential injection |
| | | | | | | Server status monitoring | Risk level inference | OAuth2 token refresh |

---

### Walking Skeleton

The thinnest end-to-end slice that connects all activities. **Critical change**: tool execution is now part of the walking skeleton because without it, injected tools are non-functional.

1. **Navigate**: Route `/tools` with sidebar nav entry + tab shell (Tools, Providers, Accounts, Access)
2. **Browse Tools**: Read-only tool list grouped by toolkit (no filters yet)
3. **Manage Providers**: Register provider dialog with auth_method adaptation
4. **Connect Accounts**: Connect button with static credential form (api_key only)
5. **Manage Access**: Grant dialog with identity picker
6. **Execute Tools**: Tool Executor in proxy pipeline (step 9) -- connects to upstream MCP server, calls tools/call, returns tool_result, multi-turn loop
7. **Govern Tools**: Deferred (governance already works via Policies page)
8. **Connect Servers**: Deferred from skeleton (manual tool creation is workaround)
9. **Discover Tools**: Deferred from skeleton (manual tool creation is workaround)

Walking skeleton delivers: admin can register a provider, member can connect an account, admin can grant tool access, both can browse tools, **and agents can actually execute injected tools end-to-end**.

### Release 1: Discovery Pipeline (outcome: admin imports tools automatically from MCP servers)

- MCP server connection dialog with transport selection
- Tool discovery via tools/list with review panel
- Selective import with risk_level inference from MCP annotations
- MCP server management (status, re-sync, remove)
- Credential-to-transport injection for authenticated MCP servers

### Release 2: Core UI CRUD (outcome: admin fully manages providers and connections via UI)

- Filter tools by status and risk_level
- Search tools by name
- OAuth2 connection flow (redirect + callback)
- Connected accounts dashboard with revoke action
- Basic auth and bearer token connection forms
- Delete/edit provider
- Tool provenance badges (manual vs discovered)

### Release 3: Access Governance (outcome: admin has full visibility and control over tool access)

- View effective toolset per identity (direct + skill-derived)
- Remove grant (revoke can_use edge)
- Attach governance policy to tool
- Rate limit display and configuration

## Scope Assessment: PASS -- 12 stories, 3 contexts (tool-registry UI, proxy pipeline, MCP client), estimated 18-22 days

Note: While this exceeds the original 8-story scope, the feature was assessed as right-sized because:
- The 3 gap stories (US-UI-09, US-UI-10, US-UI-11) are prerequisites for the feature to function end-to-end
- US-UI-12 is a natural companion to US-UI-09/10 (cannot manage what you cannot see)
- The stories split cleanly across 4 releases with independent deliverable value per release
- Each story remains 1-3 days individually

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**Walking skeleton restructured**: Tool execution (US-UI-11) is now in the walking skeleton. Without it, the entire tool injection pipeline is non-functional -- tools get injected into LLM requests but tool calls are silently dropped.

**New backbone columns added**: "Connect Servers", "Discover Tools", "Execute Tools" added to the backbone to cover the three critical gaps.

**Release order changed**: Discovery Pipeline is now Release 1 (was Release 3). Rationale: manual tool creation is the most painful bottleneck for admins onboarding new MCP servers. The original Release 1 (Core UI CRUD) is now Release 2 because it adds polish to existing API capabilities that already work.

**Story count increased**: From 8 to 12 stories. The 4 new stories address gaps that make the feature non-functional without them.
