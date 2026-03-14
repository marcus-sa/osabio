# ADR-033: Per-Session Behavior Records Over Aggregation

## Status
Proposed

## Context
Agent behavioral telemetry (TDD adherence, security compliance, etc.) must be stored for trend analysis, policy enforcement, and learning proposals. The storage model affects query patterns, data volume, and analytical flexibility.

## Decision
Store one behavior record per agent session per metric type. Records are append-only (never updated). Trends and aggregations computed at query time from raw records.

## Alternatives Considered

### Alternative 1: Running aggregate per identity + metric_type
- **What**: Single row per identity per metric_type, updated after each session with rolling average, min, max, count
- **Expected Impact**: Minimal storage (one row per agent per metric). Fast single-row reads for policy evaluation
- **Why Insufficient**: Destroys temporal granularity needed for trend detection (3+ consecutive below-threshold requires individual session scores). Cannot correlate behavior scores with specific sessions/commits for root cause analysis. UPDATE violates append-only audit requirement. Rolling averages mask sudden degradation

### Alternative 2: Event-sourced behavior stream
- **What**: Immutable event log with projections. Each behavior measurement is an event; current state computed by replaying events
- **Expected Impact**: Full audit trail, temporal queries, replay capability
- **Why Insufficient**: Over-engineered for current scale (solo developer, <50 agents). Event sourcing adds projection infrastructure, snapshot management, and replay logic. Per-session records already provide immutability and temporal ordering without the infrastructure overhead. Event sourcing adds complexity without proportional benefit at this scale

### Alternative 3: Time-series database (separate store)
- **What**: InfluxDB or TimescaleDB for behavior metrics, separate from SurrealDB graph
- **Expected Impact**: Optimized for time-series queries, retention policies, downsampling
- **Why Insufficient**: Introduces new infrastructure dependency for a solo developer. Breaks the single-graph model where all entities and relationships are queryable together. SurrealDB handles the expected data volume (50 agents * 5 metrics * 365 days = 91,250 records/year) without issues

## Consequences
- **Positive**: Full temporal granularity for trend detection. Append-only satisfies audit requirements. Simple schema. No new infrastructure. Correlatable with agent sessions and traces via graph edges
- **Negative**: Query-time aggregation for dashboards (mitigated by LIMIT + ORDER BY DESC pattern, which only reads recent records). Storage grows linearly with sessions (acceptable at current scale, can add retention/archival later)
- **Risk**: At very high agent counts (500+), behavior queries may need secondary indexes or materialized views. Current indexes (workspace + metric_type, created_at) are sufficient for 50 agents
