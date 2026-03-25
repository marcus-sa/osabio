# Story Map: Intent-Gated MCP Tool Access

## User: Coding Agent in Sandbox (primary), Human Operator (secondary), Observer Agent (supporting)
## Goal: Coding agent can call governed MCP tools through Brain, with policy-gated access, optional human veto, and full trace audit

## Backbone

| Discover Tools | Call Authorized Tool | Escalate for Gated Tool | Await Human Decision | Resume After Decision |
|----------------|---------------------|------------------------|---------------------|----------------------|
| tools/list returns effective scope | tools/call forwards to upstream | 403 intent_required response | Agent yields, human reviews | Observer detects, resumes session |
| Scope computed from session intents | Constraint validation | create_intent tool | Governance feed display | Agent retries gated call |
| Gated tools shown with instructions | Trace recording | Policy gate evaluation | Approve/veto intent | |
| | | Intent auto-approve path | Veto timeout (auto-approve) | |
| | | Composite intents | | |

---

### Walking Skeleton

The thinnest end-to-end slice that connects ALL activities:

1. **Discover Tools**: tools/list returns a hardcoded list distinguishing authorized vs gated tools based on session intents
2. **Call Authorized Tool**: tools/call checks effective scope, forwards to upstream MCP server, records trace
3. **Escalate for Gated Tool**: tools/call returns 403 intent_required; create_intent creates and evaluates intent; auto-approve path only
4. **Await Human Decision**: (degenerate -- auto-approve means no waiting)
5. **Resume After Decision**: (degenerate -- auto-approve means agent continues immediately)

Walking skeleton scope: auto-approve path only. Human veto and observer resume are Release 1 enhancements.

### Release 1: Yield-and-Resume (human veto flow)
- **Await Human Decision**: Intent with pending_veto surfaces in governance feed; human approves/vetoes
- **Resume After Decision**: Observer detects authorized intent for idle session; triggers adapter.resumeSession; agent retries

Target outcome: High-risk tool calls go through human review without blocking the agent permanently.

### Release 2: Constraint Enforcement and Composite Intents
- **Call Authorized Tool**: Constraint validation (numeric bounds, string identity) on tools/call parameters
- **Escalate for Gated Tool**: Composite intents authorizing multi-step tool chains in single intent
- **Discover Tools**: action_spec_template enrichment with parameter schema from mcp_tool registry

Target outcome: Agents can execute multi-step workflows (search then act) with a single intent, and constraint violations are caught before forwarding to upstream.

### Release 3: Operational Hardening
- **Discover Tools**: Scope caching for performance (invalidated on intent state change)
- **Call Authorized Tool**: Upstream timeout handling, retry with backoff
- **Escalate for Gated Tool**: Intent deduplication (don't create duplicate intents for same tool+params)
- **Resume After Decision**: Veto timeout auto-approve (configurable window)

Target outcome: Production-grade reliability under concurrent agent sessions.

## Prerequisites (out of scope, assumed available)
- **mcp_tool registry**: Upstream MCP server tool definitions must be populated in the registry. This is a separate feature (upstream MCP server registry design).
- **sandbox-agent-integration R2**: Proxy token with intent + session fields. Step 04-03 in sandbox-agent-integration roadmap.

## Scope Assessment: PASS -- 8 stories, 3 contexts (MCP endpoint, intent system, observer), estimated 8-10 days across 3 releases
