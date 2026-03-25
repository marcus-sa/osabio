# ADR-074: SandboxAgent SDK Adapter Interface

## Status

Proposed

## Context

Brain's orchestrator needs to integrate SandboxAgent SDK (0.x, Apache 2.0, by Rivet) to replace the Claude Agent SDK `query()` call for sandbox-executed coding agents. The SDK is pre-1.0 with expected breaking changes. Brain follows a functional paradigm with injectable dependencies and no module-level mutable singletons.

The orchestrator currently imports `@anthropic-ai/claude-agent-sdk` directly in `spawn-agent.ts` and `agent-options.ts`. A new SDK integration needs a testability seam that allows mocking in acceptance tests and isolates the orchestrator from SDK API changes.

Quality attributes driving this decision: **maintainability** (isolate SDK churn), **testability** (mock without running SandboxAgent Server), **reliability** (contain breaking change blast radius).

## Decision

Wrap SandboxAgent SDK behind a Brain-owned adapter interface defined as TypeScript types. The adapter abstracts at the **SDK level** (one factory creates the adapter, which creates sessions) rather than at the session level. Only the methods Brain actually calls are exposed.

The adapter port type is defined in the orchestrator module. The production implementation wrapping the real SDK is in a separate module. Tests inject mock implementations directly.

## Alternatives Considered

### 1. Direct SDK Usage (No Adapter)

Import SandboxAgent SDK directly throughout the orchestrator, same as the current Claude Agent SDK pattern.

- **Pro**: Simpler, fewer files, no abstraction overhead
- **Con**: Every SDK breaking change cascades through orchestrator; tests require running SandboxAgent Server or complex module mocking
- **Rejected**: SDK is 0.x from a startup. Direct coupling is acceptable for stable 1.x+ SDKs but not here.

### 2. Full Abstraction Layer (Provider Interface)

Abstract not just SandboxAgent but any agent execution backend (direct process spawn, custom WebSocket, etc.) behind a generic "agent provider" interface.

- **Pro**: Maximum flexibility for future provider changes
- **Con**: Over-engineering -- Brain has one execution backend (SandboxAgent). Generic interface requires speculative design for unknown future providers. YAGNI.
- **Rejected**: Violates simplest-solution-first principle. Can evolve the narrow adapter into a generic provider if a second backend emerges.

### 3. Session-Level Abstraction

Define the adapter interface per-session rather than per-SDK-instance. Each session would be a fully abstract object with no awareness of SandboxAgent.

- **Pro**: Completely hides SDK internals per session
- **Con**: Spreads the SDK boundary across every session creation site. Event types, permission response types, and prompt message types would all need wrapping. More surface area for bugs.
- **Rejected**: SDK-level abstraction provides a single entry point while still returning Brain-owned session handle types.

## Consequences

### Positive

- SDK breaking changes are contained to one adapter implementation file
- Acceptance tests inject mock adapters without running SandboxAgent Server
- Orchestrator depends only on Brain-owned types, not SDK exports
- Consistent with existing project pattern (ports as types, production implementations injected)

### Negative

- One additional level of indirection for SDK calls
- Adapter implementation must be updated when new SDK methods are needed
- Type definitions must be kept in sync with SDK capabilities
