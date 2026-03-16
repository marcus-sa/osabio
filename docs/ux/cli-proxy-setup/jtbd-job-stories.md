# JTBD: Brain CLI Proxy Setup

## Primary Job

> "When I set up Brain in a repo, I want Claude Code to automatically route through Brain's LLM proxy, so I can get policy enforcement, tracing, and context injection without changing how I use Claude."

### Dimensions

| Dimension | Description |
|-----------|------------|
| **Functional** | Configure Claude Code to route through Brain proxy with correct auth + workspace headers |
| **Emotional** | "It just works" — no manual config file editing, no guessing header formats |
| **Social** | Team members onboard the same way — consistent setup across developers |

## Secondary Job

> "When I start a Claude Code session, I want Brain to already know my workspace and identity, so agents get shared memory from the first message."

### Dimensions

| Dimension | Description |
|-----------|------------|
| **Functional** | Workspace ID and auth token pre-configured in Claude Code environment |
| **Emotional** | No context re-explanation — continuity from session one |
| **Social** | Every team member's agent sessions are visible in the same workspace graph |
