# ADR-035: Dynamic Behavior Definition Schema

## Status
Accepted

## Context

Brain's behavior scoring system uses a hardcoded `KNOWN_METRIC_TYPES` enum with 5 values and an ASSERT constraint on the `behavior.metric_type` field in SurrealDB. Only 2 of the 5 types have implemented scorers (TDD_Adherence, Security_First). Adding a new behavioral metric requires:

1. Adding the string to `KNOWN_METRIC_TYPES` array in `scorer.ts`
2. Adding the string to the ASSERT enum in `surreal-schema.surql`
3. Writing a new scorer function
4. Running a schema migration

Workspace admins cannot define custom behavioral standards (e.g., honesty, evidence-based reasoning) without engineering involvement.

## Decision

Create a new `behavior_definition` SCHEMAFULL table that stores user-defined behavioral standards with plain-language goal, scoring logic, and telemetry type configuration. Remove the ASSERT enum constraint from `behavior.metric_type` to allow arbitrary string values. Add an optional `definition` reference field to `behavior` records for provenance.

The `behavior_definition` table includes:
- `title`, `goal`, `scoring_logic` (plain text)
- `scoring_mode` ("llm" | "deterministic") to discriminate dispatch
- `telemetry_types` (array of strings for matching)
- `status` lifecycle ("draft" | "active" | "archived")
- `version` (integer, incremented on active definition edits)
- `enforcement_mode` ("warn_only" | "automatic") with optional threshold

## Alternatives Considered

### Alternative 1: Extend the ASSERT enum dynamically
- **What**: Keep the enum ASSERT on `behavior.metric_type` but allow dynamic values by regenerating the ASSERT with ALTER FIELD when definitions are created.
- **Expected Impact**: Solves 60% of the problem (dynamic names) but not scoring logic.
- **Why Rejected**: SurrealDB ASSERT constraints are static schema elements, not designed for frequent runtime modification. Regenerating ASSERTs on definition creation is fragile, race-prone with concurrent writes, and conflates schema management with business logic.

### Alternative 2: Store definitions as JSON in a FLEXIBLE field on workspace
- **What**: Add a `behavior_definitions` FLEXIBLE field to the workspace table containing an array of definition objects.
- **Expected Impact**: Quick to implement, solves 80% (CRUD, definition storage).
- **Why Rejected**: Loses SCHEMAFULL guarantees on definition fields. Cannot index definitions independently. Cannot version definitions or track status transitions. Workspace table becomes a catch-all. Violates the project's "keep all tables SCHEMAFULL" convention.

### Alternative 3: Definition as code (config file)
- **What**: Define behaviors in a YAML/JSON config file deployed with the application.
- **Expected Impact**: Solves 40% (multiple definitions) but not admin self-service.
- **Why Rejected**: Requires deployment to change definitions. Workspace admins cannot manage definitions. No per-workspace customization. Violates the self-service requirement (Job 1).

## Consequences

### Positive
- Workspace admins can define behavioral standards without engineering
- Definitions are workspace-scoped with full SCHEMAFULL validation
- Version tracking enables audit trail (which definition version produced a score)
- Status lifecycle prevents accidental scoring against draft/archived definitions
- Schema change is breaking (per project convention) -- no migration complexity

### Negative
- Removing the ASSERT enum loses schema-level validation of metric type strings. Typos in manually-created behavior records (via API) are no longer caught by the DB. Mitigation: application-level validation in the route handler.
- Two sources of truth for metric types: hardcoded scorers in `scorer.ts` (TDD/Security) and dynamic definitions in the table. Mitigation: represent deterministic scorers as `behavior_definition` records with `scoring_mode=deterministic` to unify the model.
