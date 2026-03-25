# Peer Review: Intent-Gated MCP Requirements

```yaml
review_id: "req_rev_20260325_120000"
reviewer: "product-owner (review mode)"
artifact: "docs/feature/intent-gated-mcp/discuss/user-stories.md"
iteration: 1

strengths:
  - "Strong traceability from research findings to user stories -- every key decision from intent-rar-mcp-tool-gating.md and architecture-design.md is reflected"
  - "Real domain examples throughout: Elena Vasquez refund, acme/billing-service repo, specific amounts and currencies"
  - "Clear separation of walking skeleton (auto-approve only) from release slices"
  - "Error paths well covered: timeout, constraint violation, policy denial, upstream failure"
  - "Shared artifact registry thoroughly maps the token-to-scope pipeline"
  - "Composite intent story (US-07) addresses multi-step workflow friction identified in research Finding 7"

issues_identified:
  confirmation_bias:
    - issue: "No consideration of the case where the mcp_tool registry itself is empty or stale"
      severity: "medium"
      location: "US-01"
      recommendation: "Add error path for empty registry or missing tool entries. The 403 template depends on registry entries existing."

  completeness_gaps:
    - issue: "No story addresses the initial population of the mcp_tool registry -- where do tool definitions come from?"
      severity: "medium"
      location: "Feature scope"
      recommendation: "This is correctly OUT OF SCOPE (upstream MCP server registry design is excluded). Add explicit note in story-map.md that mcp_tool registry population is a prerequisite handled separately."
    - issue: "US-05 observer resume: no scenario for observer being down or lagging"
      severity: "medium"
      location: "US-05"
      recommendation: "Add a note that if observer is down, the agent remains idle until next scan. Consider a fallback: agent can be manually re-prompted by human."
    - issue: "Missing NFR: tools/call latency budget. Research mentions <500ms MCP round-trip but no story captures this."
      severity: "high"
      location: "US-02"
      recommendation: "Add latency budget as @property scenario or technical note: overhead from scope computation + constraint check should be <100ms, with upstream latency being variable."

  clarity_issues:
    - issue: "US-01 says 'gated tools with enriched descriptions' but does not specify the exact enrichment format"
      severity: "low"
      location: "US-01"
      recommendation: "Add example of enriched description text in domain examples. This is a DESIGN wave detail but a concrete example helps."

  testability_concerns: []

  priority_validation:
    q1_largest_bottleneck: "YES"
    q2_simple_alternatives: "ADEQUATE"
    q3_constraint_prioritization: "CORRECT"
    q4_data_justified: "JUSTIFIED"
    verdict: "PASS"

approval_status: "conditionally_approved"
critical_issues_count: 0
high_issues_count: 1
```

## Remediation Actions

### HIGH: Latency budget for tools/call (US-02)

Added to US-02 Technical Notes:
> NFR: Brain overhead (scope computation + constraint check + trace write) must be <100ms. Total tools/call latency = Brain overhead + upstream MCP server response time. Upstream latency varies by tool provider and is outside Brain's control.

### MEDIUM: Empty registry error path (US-01)

Acknowledged. Empty registry is a degenerate case where tools/list returns only Brain-native tools and no gated tools. This is already handled by the "no intents" scenario (domain example 2). No separate story needed.

### MEDIUM: mcp_tool registry population prerequisite

Added note to story-map.md: mcp_tool registry population is a separate feature (upstream MCP server registry). This feature assumes the registry is populated.

### MEDIUM: Observer downtime fallback (US-05)

Added to US-05 Technical Notes:
> Fallback: if observer is unavailable, human operator can manually re-prompt the session via existing prompt endpoint. Observer resume is the automated happy path, not the only path.

### LOW: Enriched description format (US-01)

Added concrete example to domain example 1:
> Description enrichment: "This tool is gated. To use it, call the create_intent tool with provider 'stripe', action 'create_refund', and include your goal and reasoning. The intent will be evaluated against workspace policies."

## Review Verdict

All high-severity issues remediated. No critical issues. Conditionally approved -- remediation applied inline to stories.

### Post-Review Status: APPROVED (iteration 1)
