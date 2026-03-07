# Definition of Ready Checklist: Coding Agent Orchestrator

## DoR Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | **User need validated** | PASS | JTBD analysis with 3 jobs identified. Push force strong: manual context copy-paste to CLI agents is the current painful workflow. |
| 2 | **Acceptance criteria testable** | PASS | All criteria in Gherkin format with concrete Given/When/Then. See `journey-assign-monitor-review.feature` and user stories. |
| 3 | **Dependencies identified** | PASS | OpenCode SDK (`@opencode-ai/sdk`), existing MCP route, authority framework, SSE registry. No unresolved external dependencies. |
| 4 | **Architecture fit assessed** | PASS | Extends existing patterns: agent dispatch, MCP tools, authority scoping, agent_session tracking. Walking skeleton leverages all existing infrastructure. |
| 5 | **Scope bounded** | PASS | Explicit out-of-scope list: Modal/cloud, multi-agent, agent delegation, cost tracking. Walking skeleton defined as Feature 0. |
| 6 | **Shared artifacts tracked** | PASS | Registry in `shared-artifacts-registry.md`. All variables (`taskId`, `opencodeSessionId`, etc.) have single source of truth. |
| 7 | **Emotional arc coherent** | PASS | Confidence builds: uncertainty at assign → steady during work → satisfaction at accept. Anxiety addressed by context validation and progress streaming. |
| 8 | **Walking skeleton defined** | PASS | 4-step skeleton: backend route, MCP integration, status updates, UI button. Minimum viable end-to-end. |

## Readiness Assessment

**Result: READY for DESIGN wave**

The feature is well-scoped with clear integration points into the existing architecture. The walking skeleton approach is appropriate given the extensive existing infrastructure (MCP, authority, agent sessions, SSE).

## Key Risks to Carry Forward

| Risk | Mitigation |
|------|------------|
| OpenCode SDK stability (relatively new) | Pin version, wrap in adapter layer |
| Agent process lifecycle management (orphaned processes) | Abort timeout + cleanup on server shutdown |
| Agent quality varies by model/task complexity | Start with well-defined tasks, iterate on prompt engineering |
| Self-hosted assumes user has opencode installed | Clear setup docs, health check endpoint |

## Handoff Notes for Solution Architect

1. **Authority scope**: Define `code_agent` permissions in `authority_scope` table. Code agents should have: `create_observation` (auto), `update_task_status` (auto), `search_entities` (auto), `create_task` (propose), `confirm_decision` (blocked).

2. **Schema changes needed**: Extend `agent_session` with `opencode_session_id` field and `agent_type` enum value `code_agent`. May need `agent_assignment` relation table for task ↔ agent_session edge.

3. **OpenCode server lifecycle**: The orchestrator needs to manage connection to a running opencode server. For walking skeleton, assume the user has started it separately. Later: auto-start via SDK's `createOpencode()`.

4. **MCP configuration**: The opencode session needs to know the Brain MCP server URL + auth token. This is configured in the opencode session's MCP settings. The Brain platform generates a scoped JWT for the agent session.
