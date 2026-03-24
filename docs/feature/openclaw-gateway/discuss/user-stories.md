# User Stories — openclaw-gateway

Each story traces to at least one JTBD job story.

---

## Walking Skeleton (Release 0)

### US-0.1: WebSocket Gateway Endpoint
**As a** coding agent developer,
**I want to** connect to Brain via WebSocket at `/api/gateway`,
**So that** my OpenClaw CLI can communicate using the Gateway Protocol.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-0.1

---

### US-0.2: Agent Method — Thin Orchestrator Delegate
**As a** coding agent developer,
**I want to** submit work via the `agent` method and have Brain's orchestrator execute it with graph context,
**So that** my agent has project decisions and constraints without manual setup.

**Job**: J1 (Context-Aware Coding)
**Acceptance**: See AC-0.2

---

### US-0.3: Token Streaming via WebSocket
**As a** coding agent developer,
**I want to** receive LLM output tokens in real time as WebSocket events,
**So that** I see agent progress as it happens.

**Job**: J5 (Real-Time Streaming)
**Acceptance**: See AC-0.3

---

## Release 1: Authentication & Protocol

### US-1.1: Ed25519 Device Authentication
**As a** coding agent developer,
**I want to** authenticate with my existing OpenClaw device keys via Ed25519 challenge-response,
**So that** I don't need separate credentials for Brain.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-1.1

---

### US-1.2: Known Device Identity Resolution
**As a** coding agent developer with a registered device,
**I want to** have Brain automatically resolve my identity and workspace from my device fingerprint,
**So that** I'm immediately ready to work after connecting.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-1.2

---

### US-1.3: New Device Auto-Registration
**As a** coding agent developer connecting a new device,
**I want to** be automatically registered via DCR without manual `brain init`,
**So that** onboarding takes seconds, not minutes.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-1.3

---

### US-1.4: Protocol Frame Parsing
**As an** OpenClaw client,
**I want to** send and receive Gateway Protocol v3 frames (req/res/event),
**So that** I can communicate with Brain using the standard protocol.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-1.4

---

### US-1.5: Connection State Machine
**As a** coding agent developer,
**I want to** have my connection progress through clear states (connecting → authenticated → active → closed),
**So that** errors at each stage give me actionable feedback.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-1.5

---

## Release 2: Core Execution Pipeline

### US-2.1: Full Orchestrator Pipeline via Gateway
**As a** coding agent developer,
**I want to** have the `agent` method run the full Brain orchestrator pipeline (context + learnings + policies + budget + assign),
**So that** gateway-originated work gets the same treatment as direct Brain sessions.

**Job**: J1 (Context-Aware Coding), J3 (Governed Execution)
**Acceptance**: See AC-2.1

---

### US-2.2: Exec Approval via Gateway
**As a** coding agent developer,
**I want to** approve or deny agent exec requests in real time via `exec.approve` / `exec.deny`,
**So that** I maintain human-in-the-loop control over dangerous operations.

**Job**: J5 (Real-Time Streaming)
**Acceptance**: See AC-2.2

---

### US-2.3: Session Management
**As a** coding agent developer,
**I want to** list, query, and manage sessions via the `sessions.*` methods (list, history, send, patch),
**So that** I can monitor tasks, review traces, and adjust session settings mid-flight.

**Job**: J5 (Real-Time Streaming)
**Acceptance**: See AC-2.3

---

### US-2.4: Session History
**As a** platform engineer,
**I want to** query session traces via `sessions.history`,
**So that** I can audit what an agent did, why, and with what authorization.

**Job**: J4 (Native Traces)
**Acceptance**: See AC-2.4

---

### US-2.5: Tool Catalog
**As a** coding agent developer,
**I want to** discover available MCP tools via `tools.catalog`,
**So that** I know what capabilities are available in this workspace.

**Job**: J1 (Context-Aware Coding)
**Acceptance**: See AC-2.5

---

### US-2.6: Graceful Unsupported Methods
**As a** coding agent developer using the OpenClaw CLI,
**I want** unimplemented methods to return `method_not_supported` instead of crashing,
**So that** my client handles missing features gracefully.

**Job**: J2 (Zero-Config Onboarding)
**Acceptance**: See AC-2.6

---

## Release 3: Governance & Multi-Agent

### US-3.1: Policy Enforcement on Gateway Intents
**As a** platform engineer,
**I want to** have all gateway-originated work evaluated against the policy graph,
**So that** agents operate within defined authority scopes.

**Job**: J3 (Governed Execution)
**Acceptance**: See AC-3.1

---

### US-3.2: Per-Device Budget Enforcement
**As a** platform engineer,
**I want to** set and enforce per-device/agent budget limits on gateway connections,
**So that** no single agent consumes disproportionate resources.

**Job**: J7 (Model/Spend Control)
**Acceptance**: See AC-3.2

---

### US-3.3: Multi-Agent Presence Tracking
**As a** platform engineer,
**I want to** see which devices/agents are currently connected to the workspace,
**So that** I understand the coordination landscape.

**Job**: J6 (Multi-Agent Coordination)
**Acceptance**: See AC-3.3

---

### US-3.4: Model Listing
**As a** coding agent developer,
**I want to** query available models via `model.list`,
**So that** I know what models are available without seeing API keys.

**Job**: J7 (Model/Spend Control)
**Acceptance**: See AC-3.4

---

### US-3.5: Connection Resilience
**As a** coding agent developer,
**I want to** reconnect after a disconnect and resume my session,
**So that** network interruptions don't lose work.

**Job**: J5 (Real-Time Streaming)
**Acceptance**: See AC-3.5
