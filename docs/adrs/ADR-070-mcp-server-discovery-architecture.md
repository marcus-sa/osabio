# ADR-070: MCP Server Discovery via tools/list

## Status
Proposed

## Context

The MCP Tool Registry walking skeleton (#178) requires manual `mcp_tool` registration. Issue #184 (US-2) calls for automatic tool discovery by connecting to external MCP servers and calling `tools/list`. The MCP SDK (`@modelcontextprotocol/sdk ^1.27.1`) is already a dependency, used for the CLI MCP server. The client module from the same SDK supports SSE and Streamable HTTP transports.

Three architectural questions:
1. Where do we track connected MCP servers?
2. How do we handle the discover → review → import workflow?
3. How do we keep tools in sync via `listChanged` notifications?

## Decision

### New `mcp_server` SCHEMAFULL table

A dedicated table tracks each connected MCP server: URL, transport, status, cached capabilities, and last discovery timestamp. Tools link back via a new `source_server` field on `mcp_tool`.

**Why a new table over reusing `credential_provider`:**
- Different lifecycle — a credential_provider is a credential configuration; an MCP server is a live service endpoint with connection state, capabilities, and periodic sync.
- An MCP server may optionally reference a credential_provider for authentication, but many MCP servers require no auth.
- Conflating them would overload `credential_provider` with connection/discovery concerns.

### Two-phase discovery: dry-run preview then apply

Discovery uses a dry-run mode that returns a `DiscoveryResult` (list of tools with planned actions: create/update/disable/unchanged) without writing to the DB. The admin reviews this in a `DiscoveryReviewPanel`, optionally deselects tools, then confirms to trigger the actual sync.

**Why not auto-import on connect:**
- Risk — an MCP server may expose dozens of tools, some high-risk. The admin needs to review risk_level inferences and selectively import.
- Matches the issue's AC-11g: "admin reviews the discovered tools... selects which to import."
- Re-syncs also use preview mode so the admin sees what changed before applying.

### Servers section inside Tools tab (not a fourth tab)

MCP servers are the *source* of tools. Placing them in a separate tab would fragment the mental model. Instead, the Tools tab gains a collapsible "MCP Servers" section above the tool list.

**Why not a separate tab:**
- The story map groups "Discover Tools" in the same backbone column as "Browse Tools."
- Servers without tools are meaningless — they exist only to populate the tool list.
- Reduces tab count (3 is cleaner than 4 for this domain).

### On-demand connections only (no persistent subscriptions)

MCP client connections are short-lived: connect → `tools/list` → disconnect. The admin triggers discovery/sync explicitly. No persistent connections, no `listChanged` subscriptions.

**Why on-demand over persistent `listChanged`:**
- Persistent connections add significant complexity (reconnection logic, in-memory client registry, server shutdown cleanup, rate-limiting against malicious servers).
- Discovery is an admin-driven workflow — the admin decides when to check for changes, not the remote server.
- Eliminates an entire class of failure modes (stale connections, memory leaks, SSRF amplification via notification spam).
- Can always add `listChanged` later if on-demand proves insufficient — it's additive, not a rearchitecture.

### Risk level inference from MCP tool annotations

MCP spec's tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) map directly to Brain's `risk_level` enum. This is a heuristic — admins can override after import.

**Why heuristic over manual-only:**
- Reduces friction for large tool catalogs (a server may expose 50+ tools).
- MCP annotations are the server author's intent — a reasonable starting signal.
- Override capability preserves admin authority.

## Consequences

- New migration adding `mcp_server` table and `source_server` field on `mcp_tool`
- New backend files: `mcp-client.ts`, `discovery.ts`, `server-routes.ts`, `server-queries.ts`
- New UI components: `McpServerSection`, `AddMcpServerDialog`, `DiscoveryReviewPanel`
- The `source_server` field distinguishes manually-created tools from discovered ones — UI shows provenance badge
- SSRF risk from admin-provided URLs requires URL validation and consideration of network-level restrictions
- No persistent outbound connections — Brain server resource usage is bounded and predictable
