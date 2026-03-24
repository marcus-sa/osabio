# Outcome KPIs — openclaw-gateway

## Primary Outcomes (tied to highest-opportunity jobs)

### KPI-1: Gateway Adoption Rate
**Job**: J1 (Context-Aware Coding), J2 (Zero-Config Onboarding)
**Metric**: Number of unique devices connected via gateway protocol per week
**Target**: 10 unique devices within 4 weeks of launch
**Measurement**: Count distinct `device_fingerprint` in `agent` table where `agent_type = 'openclaw'`
**Query**: `SELECT count(DISTINCT device_fingerprint) FROM agent WHERE agent_type = 'openclaw' AND created_at > time::now() - 7d`

### KPI-2: Context Injection Rate
**Job**: J1 (Context-Aware Coding)
**Metric**: Percentage of gateway sessions that receive graph context (decisions, constraints, learnings > 0)
**Target**: 95% of sessions have non-empty context injection
**Measurement**: OTel span attribute `gateway.context_entities_injected > 0` / total gateway sessions
**Signal**: If < 95%, context loading or workspace configuration is broken

### KPI-3: Zero-Config Success Rate
**Job**: J2 (Zero-Config Onboarding)
**Metric**: Percentage of new device connections that complete DCR auto-registration without errors
**Target**: 99% success rate
**Measurement**: `connect.ok` responses for new devices / total new device `connect` attempts
**Signal**: If < 99%, DCR flow or Ed25519 verification has friction

### KPI-4: Policy Enforcement Coverage
**Job**: J3 (Governed Execution)
**Metric**: Percentage of gateway agent sessions that pass through policy evaluation
**Target**: 100% — every gateway session hits the policy graph
**Measurement**: OTel span attribute `gateway.policy_evaluated = true` on all agent sessions
**Signal**: If < 100%, there's a code path bypassing governance

### KPI-5: Trace Completeness
**Job**: J4 (Native Traces)
**Metric**: Percentage of gateway sessions with complete hierarchical traces (intent → session → tool calls)
**Target**: 100%
**Measurement**: `SELECT count() FROM trace WHERE source = 'gateway' AND depth >= 2` / total gateway sessions
**Signal**: If < 100%, trace recording is dropping events

## Secondary Outcomes

### KPI-6: Gateway Latency Overhead
**Job**: NFR-1 (Zero Additional Latency)
**Metric**: p99 additional latency introduced by gateway frame parsing and method dispatch
**Target**: < 1ms
**Measurement**: OTel span `gateway.frame_dispatch_ms`
**Signal**: If > 1ms, optimize frame parsing or method dispatch

### KPI-7: Multi-Agent Coordination Quality
**Job**: J6 (Multi-Agent Coordination)
**Metric**: Percentage of multi-agent sessions where agents receive each other's decisions in context
**Target**: 90% within 60 seconds of decision creation
**Measurement**: Compare decision `created_at` to next agent session's context load timestamp

### KPI-8: Budget Compliance Rate
**Job**: J7 (Model/Spend Control)
**Metric**: Percentage of budget-limited agents that stay within their allocation
**Target**: 100% (hard enforcement)
**Measurement**: Count of `budget_exceeded` errors vs total gateway sessions for budget-limited agents

### KPI-9: Connection Resilience
**Job**: J5 (Real-Time Streaming)
**Metric**: Percentage of disconnected sessions that are successfully resumed
**Target**: 80% resumption within 5 minutes
**Measurement**: `agent.status` queries after reconnect that return valid session state

## Leading Indicators (Early Signals)

| Indicator | Signal | Action |
|-----------|--------|--------|
| WS upgrade success rate < 99% | Bun WS handler or TLS config issue | Check server logs, connection limits |
| Ed25519 auth failure rate > 5% | Key format mismatch or nonce expiry too short | Review v3 payload format compliance |
| `agent` method error rate > 10% | Orchestrator integration issue | Review error codes, check context loading |
| Event stream disconnect rate > 20% | WS stability issue | Implement heartbeat/ping-pong, review timeouts |
| Mean time to first token > 3s | Context loading or LLM cold start | Profile orchestrator pipeline |
