# Evolution: MCP Tool Registry UI

**Date**: 2026-03-23
**Feature ID**: mcp-tool-registry-ui
**Status**: Complete

## Summary

Full-stack UI and backend implementation for managing MCP integration tools through a web interface. Workspace admins can register credential providers, connect accounts, discover tools from MCP servers, manage access grants, attach governance policies, and have those tools actually execute end-to-end when agents use them through the proxy pipeline.

## Business Context

Osabio's proxy pipeline already injected tools into LLM requests and classified tool_use responses, but integration tool calls were silently dropped — there was no executor. Admins had no UI to manage providers, accounts, or tool access. This feature closes the loop: tools configured in the UI are discoverable, grantable, governed, and executable.

## Phases Completed

### Phase 01 — Foundation: Schema, Core Endpoints, and MCP Client (9 steps)
- `mcp_server` table schema migration with transport, status, capabilities fields
- Domain types for tools, grants, servers, providers, governance
- CRUD endpoints: tool listing, tool detail, provider CRUD, account connect/revoke
- Grant management (create, list, revoke with conflict detection)
- Governance attachment/detachment endpoints
- MCP client module with transport selection, credential injection, dependency injection
- Walking skeleton acceptance test infrastructure

### Phase 02 — Discovery Service and Walking Skeleton Validation (6 steps)
- Discovery service: connect to MCP server, call `tools/list`, diff against existing records
- Sync algorithm with create/update/remove actions and selective import
- Risk level inference from MCP annotations (destructive/read-only heuristics)
- Server management routes (add, remove, list, discover, sync)
- Walking skeleton validated end-to-end: tool setup → injection → execution → result

### Phase 03 — Tool Execution Pipeline (9 steps)
- Unified multi-turn proxy loop with request-scoped MCP connections
- Mock MCP server via `InMemoryTransport` for acceptance tests
- Mock Anthropic API via MSW for proxy round-trip tests
- Tool execution acceptance tests (milestone 9): single call, multi-turn, error handling
- Full acceptance suite validation: 109 scenarios across 12 test files

### Phase 04 — Integration Testing (2 steps)
- Cross-suite isolation verification
- Complete acceptance suite green: 109/109 scenarios passing

### Phase 05 — UI Components (9 steps)
- Tool Registry page shell with tab navigation (Tools, Providers, Accounts, Access, MCP Servers)
- Providers tab: create dialog with auth_method adaptation, delete with confirmation
- Accounts tab: connect dialog, revoke action, status badges
- Tools tab: grouped list by toolkit, search/filter, risk badges
- Tool detail panel: schema viewer, grants list, governance display
- Access tab: grant table with rate limits, create grant dialog
- MCP Servers section: add dialog, remove action, discover/sync triggers
- Discovery review panel: selective import, risk override, action badges
- RTL component test suite: 57 tests across 7 files

## Key Decisions

### DISCUSS Wave
- **Tab-based navigation** over separate pages — tools, providers, accounts, access in one view
- **Tool execution in walking skeleton** — without the executor, injected tools are non-functional; skeleton must deliver end-to-end value
- **Discovery before UI polish** — automated tool import is higher value than visual refinements
- **On-demand MCP connections** — connect per request, no persistent connection pool
- **Credential injection as part of execution** — not a separate story; meaningless without execution

### DESIGN Wave
- **MCP Protocol execution replaces direct HTTP** — all integration tools execute via MCP `tools/call`
- **Connect-per-request with intra-request session reuse** — fresh connection per proxy request, reused within multi-turn loop
- **Unified tool execution in multi-turn loop** — osabio-native and integration tools execute in same loop iteration
- **MCP client as injected dependency** — `mcpClientFactory` in `ServerDependencies` enables test mocking
- **Max tool use iterations: 10** — matches documented requirement for realistic multi-tool workflows
- **MCP server status lifecycle** — `pending → connected → error → disconnected`

### DISTILL Wave
- **HTTP endpoints as driving ports** — acceptance tests drive through HTTP, not DB queries
- **DPoP auth for account endpoints, session auth for provider/tool endpoints** — matches existing auth patterns
- **Mock MCP server via InMemoryTransport** — full protocol fidelity without network
- **Mock Anthropic API via MSW** — intercepts proxy HTTP calls for end-to-end testing
- **UI-only criteria deferred to component tests** — keyboard nav, badges, filtering tested via RTL

## Lessons Learned

1. **SurrealDB reserved words**: `$session` is protected in SurrealDB v3.0 — renamed query parameter to `$sess` to avoid silent failures after retries.
2. **X-Osabio-Auth format**: The proxy token header is raw (no `Bearer` prefix). `sha256("Bearer osb_...")` ≠ `sha256("osb_...")` — documented in AGENTS.md to prevent recurrence.
3. **MSW for proxy testing**: Mock Service Worker cleanly intercepts the proxy's outbound HTTP to Anthropic API, avoiding the need for a separate mock server process.
4. **RTL preload configuration**: Moving from per-test `GlobalRegistrator` calls to `bunfig.toml` preload directives eliminated setup race conditions across test files.
5. **Discovery risk override filtering**: Must track `originalRiskLevel` per tool to distinguish intentional overrides from default inferred values in the sync payload.

## Artifacts

### Migrated to permanent locations
- `docs/architecture/mcp-tool-registry-ui/architecture.md` — System architecture (C4 diagrams, proxy pipeline, component layout)
- `docs/architecture/mcp-tool-registry-ui/architecture-mcp-discovery.md` — Discovery service architecture (sync algorithm, risk inference, MCP client)
- `docs/scenarios/mcp-tool-registry-ui/test-scenarios.md` — Acceptance test scenario specifications
- `docs/scenarios/mcp-tool-registry-ui/walking-skeleton.md` — Walking skeleton specification
- `docs/ux/mcp-tool-registry-ui/journey-tool-registry-ui.yaml` — UX journey definition
- `docs/ux/mcp-tool-registry-ui/journey-tool-registry-ui-visual.md` — UX journey visual

### Key source files (in codebase)
- `app/src/server/tool-registry/` — Server routes, queries, types, discovery service, MCP client
- `app/src/client/components/tool-registry/` — React UI components + RTL tests
- `app/src/client/hooks/` — Data hooks for tool registry
- `tests/acceptance/tool-registry-ui/` — 12 acceptance test files, 109 scenarios
- `schema/migrations/0066_mcp_server_table.surql` — Schema migration

## Metrics

- **35 roadmap steps** completed across 5 phases
- **109 acceptance test scenarios** across 12 test files
- **57 RTL component tests** across 7 files
- **~30 git commits** on feature branch
- **12 user stories** (US-UI-01 through US-UI-12)
- Delivery completed in a single day (2026-03-23)
