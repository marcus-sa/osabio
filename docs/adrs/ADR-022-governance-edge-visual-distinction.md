# ADR-022: Governance Edge Visual Distinction

## Status
Proposed

## Context

The graph view currently uses uniform styling for most edges (solid blue at 0.5 opacity) with two exceptions: `depends_on` (dashed gray) and `conflicts_with` (solid pink). Governance edges (`governing`, `protects`, `triggered_by`, `gates`, `vetoed_by`) need visual distinction so users can identify policy topology and authorization flow at a glance.

## Decision

Introduce two governance edge style groups in the `edgeStyle()` function:

1. **Policy governance edges** (`governing`, `protects`): Dashed stroke with a dedicated governance color, moderate opacity. Visually communicates "structural governance relationship" -- these edges define policy topology, not data flow.

2. **Authorization flow edges** (`triggered_by`, `gates`): Solid stroke with a distinct authorization color, higher opacity. Visually communicates "active authorization pathway" -- these edges show intent execution flow.

3. **Veto edge** (`vetoed_by`): Dashed stroke with a warning/deny color. Visually communicates "blocked/denied" -- this edge represents human intervention.

Policy nodes get a new dedicated color (distinct from all existing entity kinds) in both CSS-variable and hex-resolved color maps. Crafter selects exact color values.

## Alternatives Considered

### Alternative 1: No visual distinction
- **What**: Governance edges use the default blue solid styling
- **Expected Impact**: 0% improvement in governance visibility
- **Why Insufficient**: Policy and intent relationships become invisible in a dense graph. Users cannot distinguish governance topology from domain relationships.

### Alternative 2: Separate governance graph layer with toggle
- **What**: Client-side layer toggle that shows/hides governance edges independently
- **Expected Impact**: 100% visibility control
- **Why Insufficient**: Over-engineers the first iteration. Adds client-side state management for graph layers. Can be added later if graph density becomes problematic. Simpler to start with always-visible styled edges.

## Consequences

### Positive
- Governance topology immediately distinguishable from domain relationships
- Consistent visual language: dashed = structural/governance, solid = active flow
- Veto edges carry warning color, drawing attention to denied intents
- No new client-side state or toggles needed

### Negative
- Five new cases in `edgeStyle()` switch statement (minimal maintenance burden)
- Users cannot hide governance edges if graph becomes dense (acceptable for v1; layer toggle can follow)
