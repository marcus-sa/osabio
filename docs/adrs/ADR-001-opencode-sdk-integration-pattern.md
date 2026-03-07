# ADR-001: OpenCode SDK Integration Pattern

## Status

Accepted

## Context

Brain needs to orchestrate AI coding agents that work on tasks from the knowledge graph. The coding agent runtime is OpenCode, which provides an SDK (`@opencode-ai/sdk`) with both server management and client APIs. We need to decide how Brain interacts with OpenCode processes.

Key constraints:
- Solo developer maintaining the system
- Must support 1-3 concurrent agent sessions
- Agent processes must be reliably cleaned up (no orphans)
- Config (MCP server URLs, model settings) must be injected per workspace
- Session creation target: <5s

## Decision

**On-demand spawn (Pattern B)**: Brain lazily spawns an OpenCode server process on first task assignment via `createOpencodeServer()` from `@opencode-ai/sdk/server`. The server is spawned as a managed child process. Brain caches the client reference and kills the process on session end or server shutdown via `AbortController`.

Configuration is injected via the SDK's `config` option, which internally sets the `OPENCODE_CONFIG_CONTENT` environment variable on the child process. This includes MCP server URLs pointing back to Brain's existing MCP route handlers.

## Alternatives Considered

### Alternative 1: External Long-Running OpenCode Server

Run OpenCode as a separate always-on service. Brain connects as a client.

- **Expected impact**: Simpler client code (no process management)
- **Why insufficient**: Requires separate deployment/monitoring infrastructure. Config changes require server restart. Cannot scope config per workspace without multiplexing. Operational overhead disproportionate for solo dev with 1-3 concurrent agents. Process lifecycle not tied to Brain -- orphan risk on Brain restart.

### Alternative 2: In-Process Integration (Import OpenCode as Library)

Import OpenCode's core logic directly into Brain's Bun process.

- **Expected impact**: Zero process management overhead, fastest possible communication
- **Why insufficient**: OpenCode is designed as a standalone CLI/server, not an embeddable library. Its internal architecture assumes process-level isolation. Importing would couple Brain to OpenCode internals, creating a maintenance burden on every OpenCode upgrade. Memory isolation lost -- agent crash could take down Brain. Not supported by the SDK API surface.

### Alternative 3: Docker Container per Agent

Spawn each agent in an isolated Docker container.

- **Expected impact**: Maximum isolation, reproducible environments
- **Why insufficient**: Docker daemon dependency adds operational complexity. Container startup time (2-5s) plus OpenCode startup time would exceed <5s target. Overkill for solo dev with local development workflow. Git worktree sharing across container boundary adds volume mount complexity.

## Consequences

### Positive

- **Zero operational overhead**: No separate service to deploy or monitor
- **Config injection**: Per-workspace config passed directly via SDK options
- **Deterministic cleanup**: `AbortController.abort()` triggers `server.close()` which kills the child process. Brain shutdown handler aborts all controllers.
- **Resource efficient**: Processes only exist while tasks are active
- **SDK-supported**: Uses the SDK's designed API (`createOpencodeServer` + `createOpencodeClient`)

### Negative

- **Process management complexity**: Brain must track child processes, handle crashes, detect orphans on restart
- **Port allocation**: Each OpenCode server needs a unique port. SDK defaults to 4096 but supports custom ports. Must track allocated ports.
- **Memory ceiling**: Each OpenCode process ~100-200MB. Limits concurrent agents on single host to ~3-5.
- **Restart recovery**: If Brain crashes, child processes are orphaned. Startup recovery must detect and mark orphaned sessions as errored.

### Mitigations

- Port allocation: Use `port: 0` (OS-assigned) or sequential allocation from a configurable base
- Orphan detection: On startup, query `agent_session` for `orchestrator_status IN ["spawning", "active", "idle"]` and mark as `error`
- Memory: Document concurrent agent limit in operational runbook
