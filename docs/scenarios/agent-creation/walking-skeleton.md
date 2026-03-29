# Walking Skeleton: Agent Management

## Design Rationale

The walking skeleton validates the thinnest possible end-to-end slice through the agent management system. It answers one question: **can a workspace admin register, inspect, and decommission an external agent?**

### Why External Agents First

External agents are the simplest path that exercises the full architecture:
- Schema migration (runtime field on agent table)
- 5-step transactional creation (agent + identity + edges)
- Proxy token generation and display
- Authority model via authorized_to edges
- Graph traversal for workspace-scoped listing
- Atomic deletion with edge cleanup

Sandbox agents add configuration complexity (sandbox_config, provider validation) that is unnecessary for proving the architecture works.

### Skeleton Scenarios

| # | User Goal | Validates |
|---|-----------|-----------|
| WS-1 | Register external agent, receive proxy token | Transaction, token gen, listing |
| WS-2 | View agent detail with authority scopes | Detail query, authority edges |
| WS-3 | Delete agent, verify cleanup | Atomic deletion, edge removal |
| WS-4 | View registry with multiple runtimes | Graph traversal, runtime grouping |

### Litmus Test

Each skeleton passes the non-technical stakeholder test:

- **WS-1**: "Yes, an admin needs to register a compliance bot and get its API credentials." PASS.
- **WS-2**: "Yes, an admin needs to see what permissions an agent has." PASS.
- **WS-3**: "Yes, an admin needs to decommission an agent and know everything is cleaned up." PASS.
- **WS-4**: "Yes, an admin needs a fleet view of all agents grouped by type." PASS.

### Implementation Sequence

1. Enable WS-4 (list agents) -- requires schema migration + list query
2. Enable WS-1 (create external) -- requires 5-step transaction + token generation
3. Enable WS-2 (view detail) -- requires detail query with authority scopes
4. Enable WS-3 (delete agent) -- requires atomic deletion transaction

Each skeleton is implemented one at a time. The crafter enables one, writes inner-loop TDD until it passes, commits, then moves to the next.

## Focused Scenario Design

After the walking skeleton passes, focused scenarios cover:
- **Error paths**: duplicate name, missing auth, wrong confirmation, osabio agent restrictions
- **Boundary conditions**: workspace isolation, cross-workspace name uniqueness
- **Transaction atomicity**: no partial records on failure, full edge cleanup on deletion
- **Authority model**: default "propose" permissions, scope persistence

Total: 4 walking skeletons + 19 focused scenarios for R1 = 23 scenarios.
