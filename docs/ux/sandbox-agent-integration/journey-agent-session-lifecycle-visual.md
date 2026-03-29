# Journey Visual: Agent Session Lifecycle

## Journey Overview

```
[Configure]     [Spawn]        [Prompt]       [Monitor]      [Iterate]      [Conclude]
Admin sets up   Orchestrator   User sends     Events stream  User sends     Session ends
workspace +     creates        first prompt   to feed +      follow-ups     and persists
sandbox config  session        to agent       trace graph    to refine

Feels:          Feels:         Feels:         Feels:         Feels:         Feels:
Deliberate,     Confident,     Hopeful,       Aware,         In control,    Satisfied,
in control      fast setup     curious        informed       collaborative  complete
```

## Emotional Arc

```
Confidence
    ^
    |                                              **** Iterate ****
    |                                         ****                  ****
    |                               **** Monitor ****                    **** Conclude
    |                          ****                                               ****
    |                **** Prompt
    |           ****
    |      **** Spawn
    | ****
    | Configure
    +-----------------------------------------------------------------> Time

Start: Deliberate, in control (admin configuring)
Middle: Aware, informed (monitoring active agent)
End: Satisfied, complete (session persisted, work merged)
```

## Step 1: Configure Workspace Sandbox

**Actor**: Workspace Admin (Carla Mendes)

```
+-- Step 1: Configure Sandbox Provider ---------------------------------+
|                                                                        |
|  Osabio Dashboard > Workspace Settings > Agent Execution                |
|                                                                        |
|  Sandbox Provider:  [Local (Git Worktree)]  v                         |
|                     Docker                                             |
|                     E2B (Cloud VM)                                     |
|                                                                        |
|  Default Agent:     [Claude Code]  v                                  |
|                                                                        |
|  LLM Proxy:         https://brain.internal/proxy/llm/anthropic        |
|  MCP Endpoint:      https://brain.internal/mcp/agent/{name}           |
|                                                                        |
|  [Save Configuration]                                                  |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Deliberate (choosing right settings) | Exit: Confident (workspace ready)

---

## Step 2: Spawn Agent Session

**Actor**: Osabio Orchestrator (triggered by user request)

```
+-- Step 2: Spawn Agent Session ----------------------------------------+
|                                                                        |
|  Orchestrator receives: task:implement-rate-limiting                    |
|                                                                        |
|  1. Resolve agent grants                                               |
|     can_use: [github, slack, brain-search]                             |
|     possesses -> skill_requires: [jira]                                |
|     Effective toolset: [github, slack, brain-search, jira]             |
|                                                                        |
|  2. Register dynamic MCP endpoint                                      |
|     /mcp/agent/claude-rate-limiter-a1b2                                |
|     tools/list -> 4 governed tools                                     |
|                                                                        |
|  3. Create sandbox session                                             |
|     sdk.createSession({                                                |
|       agent: "claude",                                                 |
|       cwd: "/workspace/agent/rate-limiter-a1b2"                        |
|     })                                                                 |
|                                                                        |
|  4. Configure MCP + Proxy                                              |
|     setMcpConfig("brain", { url: .../mcp/agent/... })                  |
|     env: { ANTHROPIC_BASE_URL: .../proxy/llm/anthropic }               |
|                                                                        |
|  Result: Session ${session_id} ready                                   |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Anticipation (spawning) | Exit: Confident (session provisioned fast)

---

## Step 3: First Prompt

**Actor**: Developer (Rafael Torres)

```
+-- Step 3: First Prompt -----------------------------------------------+
|                                                                        |
|  Osabio Chat > Coding Session                                           |
|                                                                        |
|  Rafael: "Implement rate limiting for the /api/chat/messages endpoint. |
|           Use sliding window, 100 requests per minute per workspace."  |
|                                                                        |
|  [Sending to Claude Code session rate-limiter-a1b2...]                 |
|                                                                        |
|  Agent is working...                                                   |
|  > Reading app/src/server/chat/handler.ts                              |
|  > Searching codebase for existing rate limiting patterns              |
|  > [MCP] brain-search: "rate limiting middleware"                      |
|  > Creating app/src/server/http/rate-limiter.ts                        |
|                                                                        |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Hopeful, curious | Exit: Engaged (watching agent work)

---

## Step 4: Monitor Agent Activity

**Actor**: Developer (Rafael Torres) + Osabio Governance Feed

```
+-- Step 4: Monitor Activity -------------------------------------------+
|                                                                        |
|  Governance Feed (real-time)                                           |
|                                                                        |
|  [12:03:15] Tool Call: brain-search("rate limiting middleware")         |
|             Policy: APPROVED (within grant scope)                      |
|             Duration: 340ms                                            |
|                                                                        |
|  [12:03:18] File Edit: rate-limiter.ts (created, 45 lines)            |
|                                                                        |
|  [12:03:22] Tool Call: github:create-branch("feat/rate-limiting")      |
|             Policy: APPROVED (github grant active)                     |
|             Credentials: OAuth token injected                          |
|                                                                        |
|  [12:03:25] Permission Request: bash("npm test")                       |
|             [Approve Once] [Approve Always] [Reject]                   |
|                                                                        |
|  Trace Graph: session -> 3 tool calls, 2 file edits, 1 pending        |
|                                                                        |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Attentive | Exit: Aware, informed (full visibility into agent actions)

---

## Step 5: Iterate with Follow-Up Prompts

**Actor**: Developer (Rafael Torres)

```
+-- Step 5: Iterate (Multi-Turn) ---------------------------------------+
|                                                                        |
|  Agent completed initial implementation.                               |
|                                                                        |
|  Rafael: "The rate limiter should use SurrealDB for distributed state, |
|           not in-memory. Also add a bypass for health check endpoints." |
|                                                                        |
|  [Follow-up prompt to session rate-limiter-a1b2...]                    |
|                                                                        |
|  Agent is working...                                                   |
|  > Reading rate-limiter.ts                                             |
|  > Modifying to use SurrealDB counter                                  |
|  > Adding health check bypass logic                                    |
|  > Running tests...                                                    |
|                                                                        |
|  No session respawn. Context preserved from previous prompt.           |
|                                                                        |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: In control (directing the agent) | Exit: Collaborative (iterating naturally)

---

## Step 6: Session Restoration (Error Path)

**Actor**: Osabio Orchestrator (automatic)

```
+-- Step 6: Session Restoration ----------------------------------------+
|                                                                        |
|  [12:15:42] Connection to sandbox lost (network timeout)               |
|                                                                        |
|  SandboxAgent SDK: Auto-restoring session rate-limiter-a1b2...         |
|  > Creating fresh session in sandbox provider                          |
|  > Rebinding local session ID to new runtime ID                        |
|  > Replaying 23 events (8,400 chars) as context                       |
|  > Session restored successfully                                       |
|                                                                        |
|  [12:15:48] Session resumed. Agent state reconstructed.                |
|                                                                        |
|  Rafael sees: "Session temporarily interrupted. Restored automatically."|
|               "Agent has context from your previous 23 interactions."   |
|                                                                        |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Brief alarm (connection lost) | Exit: Relieved (auto-restored, no work lost)

---

## Step 7: Conclude Session

**Actor**: Developer (Rafael Torres) + Osabio Orchestrator

```
+-- Step 7: Conclude Session -------------------------------------------+
|                                                                        |
|  Agent: "Rate limiting implemented with SurrealDB backend.             |
|          All 12 tests passing. Branch feat/rate-limiting ready."       |
|                                                                        |
|  Rafael: "Looks good. End session."                                    |
|                                                                        |
|  Orchestrator:                                                         |
|  > Destroying sandbox session                                          |
|  > Session record persisted to SurrealDB                               |
|  > 47 events stored in trace graph                                     |
|  > Agent session status: completed                                     |
|  > Worktree preserved for review                                       |
|                                                                        |
|  Summary:                                                              |
|    Duration: 12 minutes                                                |
|    Prompts: 2 (initial + 1 follow-up)                                  |
|    Tool calls: 8 (all governed, all approved)                          |
|    Files modified: 3                                                   |
|    Tests: 12 passing                                                   |
|                                                                        |
+------------------------------------------------------------------------+
```

**Emotional State**: Entry: Anticipating completion | Exit: Satisfied, proud (work done, fully traced)

---

## Integration Checkpoints

| Checkpoint | Validates |
|------------|-----------|
| After Step 2 | Dynamic MCP endpoint registered and serving filtered tool list |
| After Step 2 | Proxy URL configured and accepting LLM requests |
| After Step 3 | Events flowing from SandboxAgent to SSE registry |
| After Step 4 | Tool calls traced in governance feed with policy evaluation records |
| After Step 5 | Follow-up prompt delivered to existing session (no 409) |
| After Step 6 | Session restored with correct event replay from SurrealDB |
| After Step 7 | Session record and all events persisted in knowledge graph |
