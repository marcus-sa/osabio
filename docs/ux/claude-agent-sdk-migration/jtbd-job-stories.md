# JTBD Job Stories: Replace OpenCode with Claude Agent SDK

## Job 1: Orchestrator Spawns Coding Agent

**Job Story**: When the Osabio orchestrator needs to dispatch a coding task to an autonomous agent, I want to spawn a Claude agent with full Osabio MCP tools and lifecycle hooks programmatically, so I can maintain complete control over the agent's environment, permissions, and event stream without depending on a third-party CLI process.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Spawn an agent process with MCP server, system prompt, hooks, and permission controls; receive a typed event stream; send follow-up prompts; abort cleanly |
| **Emotional** | Confidence that the agent runtime is stable, well-typed, and won't silently lose events or fail to start |
| **Social** | The orchestrator is a reliable platform that users trust to run autonomous coding agents on their codebase |

---

## Job 2: Developer Initializes Osabio Integration for Their Agent Runtime

**Job Story**: When a developer runs `osabio init` in their project, I want the CLI to configure whichever agent runtime they use (Claude Code or Claude Agent SDK) with Osabio MCP tools and lifecycle hooks, so I can start using Osabio-connected coding agents without manual configuration.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Write `.mcp.json` / hooks config for Claude Code; generate SDK bootstrap code or config for Agent SDK projects |
| **Emotional** | Zero-friction setup — run one command, everything works |
| **Social** | Osabio is a professional tool that integrates cleanly with standard agent runtimes |

---

## Job 3: Lifecycle Hooks Keep Osabio Synchronized

**Job Story**: When a coding agent session starts, processes prompts, uses tools, or ends, I want lifecycle hooks to automatically load context, inject osabio state, catch unlogged decisions, and record session summaries, so the knowledge graph stays current without manual intervention.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Execute hook callbacks at SessionStart, PreToolUse, UserPromptSubmit, Stop, PreCompact, SessionEnd; each hook calls Osabio API |
| **Emotional** | Trust that nothing falls through the cracks — every decision and observation is captured |
| **Social** | The knowledge graph reflects reality; other agents and humans see accurate, up-to-date state |
