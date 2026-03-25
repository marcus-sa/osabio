# Prioritization: Intent-Gated MCP Tool Access

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton | Agent can discover and call governed tools end-to-end (auto-approve only) | Agent completes tool call through governance pipeline | Validates core architecture: dynamic endpoint + scope computation + intent creation + upstream forwarding |
| 2 | R1: Yield-and-Resume | High-risk tool calls go through human review without permanently blocking agent | Time from human approval to agent resume < 30s | Derisks the hardest architectural piece: cross-actor coordination (agent yield, human approve, observer resume) |
| 3 | R2: Constraints + Composites | Multi-step workflows authorized efficiently; constraint violations caught before upstream | Agents complete multi-tool chains with single intent | Highest value for real-world usage patterns (search-then-act) |
| 4 | R3: Operational Hardening | Production reliability under concurrent sessions | Zero dropped tool calls from timeout/retry failures | Evergreen improvement, not time-critical |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-01: Dynamic tools/list | WS | P1 | KPI-1: tool discovery | sandbox-agent-integration R2 (proxy token) |
| US-02: Authorized tools/call | WS | P1 | KPI-1: tool execution | US-01 |
| US-03: Gated tools/call + create_intent (auto-approve) | WS | P1 | KPI-1: escalation flow | US-01, US-02 |
| US-04: Human veto flow | R1 | P2 | KPI-2: human-in-the-loop | US-03 |
| US-05: Observer resume trigger | R1 | P2 | KPI-2: session resume | US-04 |
| US-06: Constraint enforcement | R2 | P3 | KPI-3: safety | US-02 |
| US-07: Composite intents | R2 | P3 | KPI-3: multi-tool chains | US-03 |
| US-08: Operational hardening | R3 | P4 | KPI-4: reliability | US-01 through US-07 |

> **Note**: Story IDs (US-01 through US-08) are assigned here as placeholders. Full story definitions follow in user-stories.md.

## Riskiest Assumptions

1. **Observer can reliably detect and resume sessions** -- If the observer's graph scan misses the authorized intent or the resume call fails, agents are stuck forever. This is why R1 (yield-and-resume) is priority 2 -- it derisks the most novel architectural pattern.

2. **Agents understand the yield protocol** -- The agent must interpret `pending_veto` status and stop making calls. If agents ignore the signal and keep calling, they'll get repeated 403s. Mitigation: clear tool description instructs the agent.

3. **Scope computation is performant** -- Every tools/list and tools/call computes effective scope by traversing gates edges and unioning authorization_details. Under many intents this could be slow. Mitigation: R3 adds scope caching.
