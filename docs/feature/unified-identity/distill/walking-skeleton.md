# Walking Skeleton Rationale

## What the Walking Skeleton Proves

The walking skeleton (`walking-skeleton.test.ts`) is the thinnest possible vertical slice through the unified identity model. It answers the question: **"Can the system represent both humans and agents as first-class citizens and traverse the graph between them?"**

## Three Scenarios, One Vertical Slice

### Scenario 1: Human identity hub creation + spoke traversal

Creates an `identity` hub record for a human, links it to a `person` spoke via `identity_person` edge, and traverses from identity to person. This proves:
- The `identity` table exists and accepts records
- The `identity_person` relation table exists
- Graph traversal from hub to spoke works

### Scenario 2: Agent identity + managed_by chain

Creates a human identity, an agent spoke with `managed_by` pointing to the human, an agent identity hub, and an `identity_agent` spoke edge. Then traverses the managed_by chain from agent identity to human identity. This proves:
- The `agent` table exists and accepts records
- The `identity_agent` relation table exists
- The `managed_by` reference resolves across the spoke edge
- The chain reaches a human identity in exactly 1 hop

### Scenario 3: Workspace-scoped identity query

Creates both a human and an agent identity in the same workspace and queries all identities for that workspace. This proves:
- Both actor types coexist in the same workspace
- Workspace-scoped queries return both types
- The `workspace` field on identity is functional

## Why Not a More Complex Skeleton?

The skeleton deliberately avoids:
- **Auth/session integration** -- That is US-UI-004's concern. The skeleton validates the data model, not the auth layer.
- **Bootstrap via HTTP** -- The skeleton uses direct SurrealDB queries as the driving port. The bootstrap HTTP endpoint is tested in US-UI-002.
- **Ownership edge migration** -- Testing that `task.owner` accepts `record<identity>` is US-UI-003's concern.

The skeleton is minimal because its purpose is to prove the foundational schema works before any downstream story builds on it. If the hub-spoke model cannot store and traverse identity records, nothing else can proceed.

## Stakeholder Demo Value

A non-technical stakeholder can confirm: "Yes, we need the system to know that Marcus is a human and PM Agent is an agent, and that PM Agent is managed by Marcus. The skeleton proves the system can represent and look up this relationship."

## Driving Port

The walking skeleton uses **SurrealDB queries** as the driving port. This is appropriate because US-UI-001 is a schema-layer story -- the deliverable is the schema migration itself. There is no HTTP endpoint to test yet; the schema is the public interface.

Subsequent stories (US-UI-002+) switch to **HTTP endpoints** as the driving port since they deliver application logic accessible through the API.
