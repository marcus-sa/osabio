# Prioritization — openclaw-gateway

## Prioritization Framework

Scored on three axes (1-5 each):
- **Outcome Impact**: How directly does this deliver on the highest-opportunity jobs?
- **Risk Reduction**: Does this validate critical assumptions early?
- **Dependency Unblocking**: How many downstream stories depend on this?

## Release Priority Order

### Release 0: Walking Skeleton (FIRST)
**Rationale**: Validates the full pipeline end-to-end with minimal scope. Proves WebSocket transport, protocol framing, orchestrator integration, and event streaming all work together. Every subsequent release builds on this foundation.

| Risk validated | Assumption |
|----------------|------------|
| WS transport works with Bun | Bun's native WebSocket handles Gateway Protocol framing |
| Orchestrator accepts gateway-originated work | Existing `assignTask()` works with gateway connection context |
| Event bridge maps cleanly | Brain `StreamEvent` → Gateway Protocol events is lossless |

### Release 1: Authentication & Protocol (SECOND)
**Rationale**: Without real auth, no external OpenClaw client can connect. This is the gate to all external adoption. Highest dependency unblocking score.

| Risk validated | Assumption |
|----------------|------------|
| Ed25519 ↔ DPoP bridge works | Same key pair can serve both protocols |
| DCR auto-registration is seamless | New devices onboard without manual steps |
| Protocol framing is spec-compliant | OpenClaw clients can parse Brain's frames |

### Release 2: Core Execution (THIRD)
**Rationale**: Delivers on J1 (highest opportunity score = 16). This is where Brain's differentiation shows — context injection, learning injection, full event streaming with exec approval.

### Release 3: Governance (FOURTH)
**Rationale**: Delivers on J3 (opportunity score = 15) and J6 (score = 14). Platform engineers need this before trusting the gateway for production use.

### Release 4: Device Management (LAST)
**Rationale**: Nice-to-have polish. Core value is delivered by R0-R3.

## Story-Level Priority (Within Releases)

### Must-Have Stories (Walking Skeleton + R1 + R2 core)
These form the minimum viable gateway:

1. WS upgrade + connection state machine (R0/R1)
2. Protocol frame parsing (R1.4)
3. Ed25519 challenge-response (R1.1)
4. Known device identity resolution (R1.2)
5. DCR auto-registration (R1.3)
6. `agent` method → orchestrator (R2.1)
7. Graph context injection (R2.2)
8. Event bridge (R2.4)
9. `exec.approve/deny` (R2.5)
10. Policy evaluation (R3.1)

### Should-Have Stories
11. `agent.wait` / `agent.status` (R2.6-2.7)
12. `agent.history` (R2.8)
13. Budget enforcement (R3.2)
14. Presence tracking (R3.4)
15. WS reconnection (R3.7)

### Could-Have Stories
16. `chat.send` (R4.4)
17. Device management (R4.1-4.3)
18. OTel gateway metrics (R4.5)
