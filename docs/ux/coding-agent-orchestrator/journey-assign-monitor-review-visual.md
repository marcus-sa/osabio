# Journey: Assign Task to Coding Agent → Monitor → Review

## Actors
- **User**: Engineering lead / developer using Osabio platform
- **Osabio Platform**: The web application
- **OpenCode Agent**: Coding agent running via OpenCode SDK
- **Osabio MCP Server**: Provides workspace context to the agent

## UI Surface Model (Hybrid Pattern)

Three surfaces handle distinct concerns. See `ui-surface-mapping.md` for full specification.

| Surface | Role | Entry Point |
|---------|------|-------------|
| **Task Popup** (EntityDetailPanel) | Delegation trigger + status badge | Click task node in graph |
| **Governance Feed** | Human-attention-needed alerts | Always visible in feed panel |
| **Agent Review View** | Full diff review + accept/reject | "Review" button from popup or feed |

## Journey Map

```
Phase:     ASSIGN                  WORKING                    REVIEW
Surface:   Task Popup              Task Popup + Feed          Review View
           ┌──────────┐           ┌──────────────────┐       ┌──────────────┐
User       │ Clicks    │           │                  │       │              │
           │ task in   │           │ Task popup shows │       │ Opens Review │
           │ graph     │           │ "Agent working"  │       │ View (full   │
           │    │      │           │ badge + file     │       │ screen)      │
           │    ▼      │           │ count            │       │    │         │
           │ Sees task │           │                  │       │    ▼         │
           │ popup w/  │           │ Feed shows alert │       │ Reads diff + │
           │ "Assign   │           │ only if agent    │       │ agent summary│
           │ to Agent" │           │ needs attention  │       │    │         │
           │    │      │           │ (stall, error,   │       │    ▼         │
           │    ▼      │           │  question)       │       │ Accepts or   │
           │ Clicks    │           │                  │       │ rejects with │
           │ button    │           │ Feed: "Review    │       │ feedback     │
           │           │           │ ready" when idle │       │              │
           └────┬──────┘           └────┬─────────────┘       └────┬─────────┘
                │                       │                          │
    ────────────┼───────────────────────┼──────────────────────────┼──────────
                │                       │                          │
Platform   ┌────▼──────┐           ┌────▼─────────────┐       ┌────▼─────────┐
           │ Validate  │           │ Route SSE events:│       │ Present diff │
           │ task +    │           │                  │       │ + session    │
           │ guard     │           │ agent_status →   │       │ trace        │
           │    │      │           │   task popup     │       │    │         │
           │    ▼      │           │ agent_file_change│       │    ▼         │
           │ Create    │           │   → popup count  │       │ On accept:   │
           │ worktree  │           │ agent_stall →    │       │ merge branch │
           │ + session │           │   feed (blocking)│       │ + done       │
           │    │      │           │ idle →           │       │              │
           │    ▼      │           │   feed (review)  │       │ On reject:   │
           │ Inject    │           │                  │       │ send feedback│
           │ MCP +     │           └──────────────────┘       │ → agent      │
           │ context   │                                      │ resumes      │
           │    │      │                                      └──────────────┘
           │    ▼      │
           │ Send task │
           │ prompt    │
           └────┬──────┘
                │
    ────────────┼──────────────────────────────────────────────────
                │
Agent      ┌────▼──────────────────────────────────────────────────┐
           │ 1. Read project context via MCP                       │
           │ 2. Understand codebase (files, patterns, schema)      │
           │ 3. Implement changes                                  │
           │ 4. Run tests if available                             │
           │ 5. Report completion via MCP (update_task_status)     │
           │ 6. Create observation if blocked                      │
           └───────────────────────────────────────────────────────┘
```

## Emotional Arc

```
Confidence
    ▲
    │                                              ┌─── Accept: "That
    │                                         ┌────┘    was easy!"
    │                                    ┌────┘
    │               ┌── Agent working ──┘
    │          ┌────┘    (steady)
    │     ┌────┘
    │     │ ← Context validated,
    │     │   session created
    │ ────┘
    │ ← "Will this work?"
    │   (initial uncertainty)
    └──────────────────────────────────────────────► Time
      Click    Session    Agent      Agent      Review
      Assign   Created   Working    Complete   Accept
```

## Key Decision Points

| Step | Decision | Default | Alternative |
|------|----------|---------|-------------|
| Assign | Which model/provider? | Workspace default | User selects |
| Assign | Which git branch? | Auto-create feature branch | User specifies |
| Working | Agent hits a blocker? | Create observation, pause | Ask user via chat |
| Review | Accept output? | Mark task done | Send back with feedback |

## Shared Artifacts

| Artifact | Created At | Used At | Source |
|----------|-----------|---------|--------|
| `task` record | Pre-existing | Assign (read context) | Knowledge graph |
| `agent_session` | Assign | Monitor, Review | Osabio platform |
| OpenCode `Session` | Assign | Working, Monitor | OpenCode SDK |
| MCP context packet | Assign | Working | Osabio MCP server |
| File changes / diff | Working | Review | Git / OpenCode |
| Session trace | Working | Review | OpenCode events |
| `observation` (if blocked) | Working | Monitor | Osabio MCP |

## Error Paths

| Error | Detection | Recovery |
|-------|-----------|----------|
| Task lacks context | Assign validation | Show "add description first" |
| OpenCode server unreachable | Session creation fails | Show error, suggest checking opencode status |
| Agent loops / stalls | Timeout or step count limit | Auto-abort, create observation, notify user |
| Agent breaks tests | Test failure in agent output | Agent retries or reports blocker |
| MCP auth failure | 401 from Osabio MCP | Log error, agent continues without context |
