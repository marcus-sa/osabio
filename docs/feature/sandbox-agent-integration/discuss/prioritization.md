# Prioritization: Sandbox Agent Integration

## Release Priority

| Priority | Release | Target Outcome | Opportunity Score | Rationale |
|----------|---------|---------------|-------------------|-----------|
| 1 | Walking Skeleton | End-to-end flow works: spawn, prompt, follow-up, persist, conclude | 18.0 (multi-turn) | Validates core assumption: SandboxAgent SDK replaces Claude Agent SDK |
| 2 | Release 1: Multi-Turn + Persistence | Developers iterate on coding tasks without respawning; sessions survive restarts | 16.0 (restoration) | Highest user-visible pain (409 on prompt, lost sessions) |
| 3 | Release 2: MCP Endpoint Governance | Sandbox agents have same governance as native agents | 12.5 (governance parity) | Required for production use -- ungoverned agents are a security gap |
| 4 | Release 3: Provider Configuration | Admins choose isolation level and agent type | 8.4 (config) | Strategic -- enables cloud deployment but local works for now |

## Riskiest Assumptions

| # | Assumption | Risk | Validation |
|---|-----------|------|-----------|
| 1 | SandboxAgent SDK session.prompt() works for multi-turn with Claude Code | HIGH | Walking skeleton proves this immediately |
| 2 | SurrealDB can handle event write throughput from active coding sessions | MEDIUM | Persistence driver in WS; benchmark during Release 1 |
| 3 | Dynamic MCP endpoint latency is acceptable for interactive tool calls | MEDIUM | Release 2 measures round-trip latency |
| 4 | Event schema translation preserves enough detail for governance feed | LOW | Event bridge in WS; visual verification |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-01: Spawn session via SandboxAgent SDK | WS | P1 | Multi-turn sessions | None |
| US-02: SurrealDB session persistence driver | WS | P1 | Session persistence | None |
| US-03: Event bridge for SandboxAgent events | WS | P1 | Event streaming | US-01 |
| US-04: Multi-turn prompts via session.prompt() | WS/R1 | P1 | Multi-turn sessions | US-01 |
| US-05: Session restoration from persisted events | R1 | P1 | Session restoration | US-02 |
| US-06: Dynamic MCP endpoint per agent session | R2 | P2 | Governance parity | US-01 |
| US-07: Permission request handling | R2 | P2 | Governed autonomy | US-06 |
| US-08: Event bridge governance context | R2 | P2 | Observability parity | US-03, US-06 |
| US-09: Workspace sandbox provider configuration | R3 | P3 | Provider flexibility | US-01 |
| US-10: Agent type portability | R3 | P3 | Agent flexibility | US-01 |

> **Note**: Story IDs (US-01 through US-10) are placeholders assigned in Phase 2.5.
> Final story definitions with full LeanUX template appear in Phase 4 (Requirements).

## MoSCoW Classification

| Category | Stories | Rationale |
|----------|---------|-----------|
| **Must Have** | US-01, US-02, US-03, US-04 | Core migration -- without these, SandboxAgent integration has no value |
| **Should Have** | US-05, US-06, US-07 | Session restoration and governance parity -- required for production |
| **Could Have** | US-08, US-09 | Enhanced observability and provider config -- valuable but not blocking |
| **Won't Have** | US-10 | Agent portability -- strategic, no immediate demand |

## Value/Effort Matrix

|               | Low Effort (1-2 days) | High Effort (3+ days) |
|---------------|----------------------|----------------------|
| **High Value** | US-04 (multi-turn prompt), US-03 (event bridge) | US-01 (spawn migration), US-02 (persistence driver), US-06 (MCP endpoint) |
| **Low Value** | US-10 (agent type) | US-09 (provider config UI) |

Quick wins: US-04 and US-03 -- multi-turn prompts and event bridge are thin wrappers over SandboxAgent SDK capabilities.

Strategic investments: US-01, US-02, US-06 -- core architectural changes requiring careful implementation.
