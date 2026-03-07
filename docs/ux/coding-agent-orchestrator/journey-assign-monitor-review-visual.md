# Journey: Assign Task to Coding Agent → Monitor → Review

## Actors
- **User**: Engineering lead / developer using Brain platform
- **Brain Platform**: The web application
- **OpenCode Agent**: Coding agent running via OpenCode SDK
- **Brain MCP Server**: Provides workspace context to the agent

## Journey Map

```
Phase:     ASSIGN                  WORKING                    REVIEW
           ┌──────────┐           ┌──────────────────┐       ┌──────────────┐
User       │ Views task│           │ Monitors activity│       │ Reviews diff │
           │ details   │           │ feed (optional)  │       │ + reasoning  │
           │    │      │           │    │             │       │    │         │
           │    ▼      │           │    ▼             │       │    ▼         │
           │ Clicks    │           │ Sees status:     │       │ Accepts or   │
           │ "Assign   │           │ working/blocked  │       │ requests     │
           │ to Agent" │           │                  │       │ changes      │
           └────┬──────┘           └────┬─────────────┘       └────┬─────────┘
                │                       │                          │
    ────────────┼───────────────────────┼──────────────────────────┼──────────
                │                       │                          │
Platform   ┌────▼──────┐           ┌────▼─────────────┐       ┌────▼─────────┐
           │ Validate  │           │ Stream opencode  │       │ Present diff │
           │ task has   │           │ events → SSE     │       │ + session    │
           │ context   │           │ to UI            │       │ trace        │
           │    │      │           │                  │       │    │         │
           │    ▼      │           │ Update task      │       │    ▼         │
           │ Create    │           │ status on key    │       │ Update task  │
           │ opencode  │           │ events           │       │ status:      │
           │ session   │           │                  │       │ done/open    │
           │    │      │           └──────────────────┘       └──────────────┘
           │    ▼      │
           │ Inject    │
           │ MCP +     │
           │ context   │
           │    │      │
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
| `agent_session` | Assign | Monitor, Review | Brain platform |
| OpenCode `Session` | Assign | Working, Monitor | OpenCode SDK |
| MCP context packet | Assign | Working | Brain MCP server |
| File changes / diff | Working | Review | Git / OpenCode |
| Session trace | Working | Review | OpenCode events |
| `observation` (if blocked) | Working | Monitor | Brain MCP |

## Error Paths

| Error | Detection | Recovery |
|-------|-----------|----------|
| Task lacks context | Assign validation | Show "add description first" |
| OpenCode server unreachable | Session creation fails | Show error, suggest checking opencode status |
| Agent loops / stalls | Timeout or step count limit | Auto-abort, create observation, notify user |
| Agent breaks tests | Test failure in agent output | Agent retries or reports blocker |
| MCP auth failure | 401 from Brain MCP | Log error, agent continues without context |
