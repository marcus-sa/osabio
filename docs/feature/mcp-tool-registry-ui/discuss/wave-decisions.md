# Wave Decisions -- Tool Registry UI (DISCUSS)

## Decision 1: Tab-based navigation vs separate pages

**Decision**: Single page with tab navigation (Tools, Providers, Accounts, Access)
**Rationale**: Follows existing Brain UI patterns (Policies uses list/detail). Tool Registry is a single bounded context with shared data across views. Tabs minimize navigation friction and keep shared context visible. Four tabs is within Hick's Law limit (5-7 items).
**Alternatives considered**: Separate routes per section (/tools/providers, /tools/accounts). Rejected because cross-tab consistency is simpler with shared query cache in a single page component.

## Decision 2: Story splitting from US-11

**Decision**: Split XL story US-11 into 8 right-sized stories (US-UI-01 through US-UI-08)
**Rationale**: Original US-11 had 7 sub-capabilities and would take 2+ weeks as a single story. Elephant Carpaccio: each slice delivers a verifiable behavior. Walking skeleton (5 stories) delivers the end-to-end admin+member journey. Release 1 adds OAuth2 and dashboard. Release 2 adds governance. Each story is 1-2 days.
**Traceability**: US-UI-01..08 all trace to US-11 from the parent feature.

## Decision 3: MCP Server Discovery deferred (REVISED)

**Decision**: ~~Defer MCP Server Discovery UI to a separate deliverable~~ **Reversed**: MCP Server Discovery now included as US-UI-09, US-UI-10, US-UI-12.
**Rationale for reversal**: Research and architecture review revealed that without discovery, every tool must be created manually with exact JSON schemas. This does not scale -- a single MCP server can expose 20+ tools. Discovery is the second-highest priority after tool execution.
**Original rationale**: US-2 backend was "not in walking skeleton scope." This was valid at the time but the scope has expanded to deliver end-to-end functionality.

## Decision 4: OAuth2 flow -- same-window redirect

**Decision**: Use same-window redirect (not popup) for OAuth2 authorization
**Rationale**: Popups are blocked by default in many browsers. Same-window redirect is the standard pattern for OAuth2 on web. The callback URL redirects back to the Providers tab. State parameter provides CSRF protection.
**Trade-off**: User briefly leaves Brain during authorization. Pre-redirect dialog with scope summary provides context before departure.

## Decision 5: Admin vs member permissions in UI

**Decision**: UI renders all tabs for all users; admin-only actions (register provider, grant access, attach governance) are disabled or hidden for non-admin members
**Rationale**: Members benefit from seeing the full tool registry (browse tools, view providers) even if they cannot modify it. This follows progressive disclosure: visible but disabled is more discoverable than hidden. Backend enforces authorization regardless of UI.
**Note**: Specific permission model (admin role check) deferred to DESIGN wave.

## Decision 6: JTBD reuse -- no new JTBD artifacts

**Decision**: Reuse existing JTBD artifacts from docs/ux/mcp-tool-registry/
**Rationale**: The four jobs (J1-J4) and four forces analysis were completed during the backend DISCUSS wave. The UI serves J1 and J2 exclusively. No new jobs discovered during UI journey mapping. Creating redundant JTBD artifacts would violate single source of truth.
**Revision note**: J3 (Tool Discovery) and J4 (Tool Execution) are now in scope for this feature. They were previously marked "no UI needed" but the backend capabilities were missing.

## Decision 7: Tool Execution in walking skeleton (NEW)

**Decision**: Include Tool Executor (US-UI-11) in the walking skeleton, not deferred to a later release.
**Rationale**: Without the executor, the entire tool injection pipeline is non-functional. The proxy classifies tool calls (step 8.5) but silently drops them. This means that even if an admin sets up providers, connects accounts, grants access, and tools are injected into LLM requests -- nothing happens when the LLM uses those tools. The walking skeleton must deliver end-to-end value: tool setup -> tool injection -> tool execution -> tool result.
**Impact**: Walking skeleton grows from 5 to 6 stories but delivers a functionally complete pipeline.

## Decision 8: Discovery before UI polish (NEW)

**Decision**: Re-prioritize releases: Discovery Pipeline (US-UI-09, 10, 12) is Release 1; Core UI CRUD is Release 2.
**Rationale**: Manual tool creation (the workaround without discovery) requires admins to copy exact JSON schemas from MCP server documentation -- a process taking 5+ minutes per tool and scaling poorly for servers with 20+ tools. The existing backend APIs for providers, accounts, and grants already work via curl/API. UI polish for those APIs (Release 2) is valuable but less urgent than eliminating the manual tool creation bottleneck.
**Trade-off**: Admin does more via API in early releases. Acceptable because admins who set up MCP integrations are technically proficient.

## Decision 9: On-demand MCP connections for execution (NEW)

**Decision**: Tool execution uses connect-per-call pattern (connect -> tools/call -> disconnect), consistent with ADR-070's on-demand architecture.
**Rationale**: Persistent MCP client connections would add reconnection logic, in-memory client registry, session cleanup, and rate-limiting complexity. Connect-per-call is simpler and consistent with the discovery pattern. MCP sessions can be reused within a single proxy request via `mcp-session-id` header, but connections are not held across requests.
**Trade-off**: Higher latency per tool call (connection overhead). Acceptable for initial release; can add connection pooling later if latency is problematic.
**Reference**: ADR-070, LiteLLM research showing connect-per-operation pattern works in production.

## Decision 10: Credential injection as part of execution, not separate story (NEW)

**Decision**: Credential-to-MCP-transport injection is part of US-UI-11 (Tool Execution), not a separate story.
**Rationale**: Credential injection only matters during tool execution and discovery (US-UI-09). Separating it would create a story with no independently verifiable behavior -- "credentials are injected" is meaningless without "and the tool call succeeds." Keeping it in US-UI-11 ensures the acceptance criteria test the full chain: decrypt credential -> inject header -> connect -> execute -> return result.
**Anti-pattern avoided**: Technical-layer splitting (a credential injection story would be an "Implement-X" anti-pattern).

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**Decision 3 reversed**: MCP Server Discovery is no longer deferred. Three new decisions (7, 8, 9, 10) added to document the rationale for including tool execution in the walking skeleton, re-prioritizing discovery, choosing on-demand connections for execution, and keeping credential injection within the execution story.

**Decision 6 updated**: Added revision note that J3 and J4 are now in scope.
