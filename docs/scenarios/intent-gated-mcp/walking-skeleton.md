# Walking Skeletons: Intent-Gated MCP Tool Access

## Walking Skeleton Identification

Three walking skeletons that each deliver observable user value end-to-end.

### WS-1: Agent discovers tools and calls an ungated tool

**User goal**: Agent discovers which tools are available and successfully calls one it is authorized for.

**E2E path**: proxy token auth -> session resolution -> scope computation -> tools/list response -> tools/call -> upstream forwarding -> trace record

**Stakeholder demo**: "The agent connected, saw which tools it could use, called one, and got the result back."

**Stories**: US-01 (tools/list), US-02 (tools/call)

### WS-2: Agent escalates for gated tool and calls after auto-approval

**User goal**: Agent encounters a gated tool, self-escalates by creating an intent, gets auto-approved, and successfully calls the tool.

**E2E path**: tools/call -> 403 intent_required -> create_intent -> policy gate (auto-approve) -> gates edge -> retry tools/call -> upstream forwarding -> result

**Stakeholder demo**: "The agent was told it needed permission, asked for it, got approved by policy, and then completed the tool call -- all without human intervention."

**Stories**: US-01, US-02, US-03

### WS-3: Agent yields on pending veto and resumes after human approval

**User goal**: Agent needs a high-risk tool, creates an intent requiring human veto, yields execution, human approves, agent resumes and completes the call.

**E2E path**: create_intent -> pending_veto -> session idle -> human approve endpoint -> intent authorized -> observer detect -> adapter.resumeSession -> tools/call success

**Stakeholder demo**: "The agent asked for permission to do something risky, waited for a human to review it, and once approved, automatically resumed and completed the work."

**Stories**: US-03, US-04, US-05

## Implementation Sequence

Enable scenarios in this order (one-at-a-time TDD):

1. **WS-1** -- validates core auth + scope + tools/list + tools/call pipeline
2. **HP-1** through **HP-3** -- refines tools/list classification logic
3. **EP-1**, **EC-1** -- auth and session error paths
4. **HP-4**, **EC-2** -- tools/call forwarding and trace recording
5. **EP-2**, **EP-3** -- gated tool 403 response
6. **WS-2** -- create_intent auto-approve flow (composes previous scenarios)
7. **HP-5**, **HP-6** -- intent-to-scope propagation
8. **EP-4**, **EP-5** -- policy-denied intent paths
9. **HP-7** -- pending_veto path
10. **HP-8**, **HP-9** -- human approve/veto endpoints
11. **WS-3** -- yield-and-resume (composes veto + observer + resume)
12. **EP-6**, **EP-7**, **EP-8** -- constraint enforcement (R2)
13. **HP-10** -- composite intents (R2)
14. **EC-3** -- intent dedup (R3)
