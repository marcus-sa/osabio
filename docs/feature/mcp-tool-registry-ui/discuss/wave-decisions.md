# Wave Decisions -- Tool Registry UI (DISCUSS)

## Decision 1: Tab-based navigation vs separate pages

**Decision**: Single page with tab navigation (Tools, Providers, Accounts, Access)
**Rationale**: Follows existing Brain UI patterns (Policies uses list/detail). Tool Registry is a single bounded context with shared data across views. Tabs minimize navigation friction and keep shared context visible. Four tabs is within Hick's Law limit (5-7 items).
**Alternatives considered**: Separate routes per section (/tools/providers, /tools/accounts). Rejected because cross-tab consistency is simpler with shared query cache in a single page component.

## Decision 2: Story splitting from US-11

**Decision**: Split XL story US-11 into 8 right-sized stories (US-UI-01 through US-UI-08)
**Rationale**: Original US-11 had 7 sub-capabilities and would take 2+ weeks as a single story. Elephant Carpaccio: each slice delivers a verifiable behavior. Walking skeleton (5 stories) delivers the end-to-end admin+member journey. Release 1 adds OAuth2 and dashboard. Release 2 adds governance. Each story is 1-2 days.
**Traceability**: US-UI-01..08 all trace to US-11 from the parent feature.

## Decision 3: MCP Server Discovery deferred

**Decision**: Defer MCP Server Discovery UI to a separate deliverable
**Rationale**: US-2 backend (MCP server discovery via tools/list) was explicitly noted as "not in walking skeleton scope" in the evolution doc. Building UI for a non-existent backend is premature. The 8 stories cover all implemented backend capabilities.
**Impact**: No story for discovery UI in this DISCUSS wave. When US-2 backend is implemented, a follow-up DISCUSS wave will add the discovery UI story.

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
