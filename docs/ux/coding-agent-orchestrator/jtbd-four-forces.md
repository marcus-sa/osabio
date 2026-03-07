# Four Forces Analysis: Coding Agent Orchestrator

## Job 1: Assign Task to Coding Agent

```
                    PUSH (frustration)                    PULL (desired future)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Manual copy-paste   │              │ One-click assign    │
              │ of task context     │              │ from task card      │
              │ into CLI agents.    │              │                     │
              │ Context is lost     │              │ Agent inherits full │
              │ between sessions.   │              │ project context via │
              │ No link back to     │              │ MCP automatically.  │
              │ the task system.    │              │ Status updates flow │
              │                     │              │ back to task.       │
              └─────────────────────┘              └─────────────────────┘

              ANXIETY (concerns)                   HABIT (current behavior)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Will the agent      │              │ Open terminal, run  │
              │ understand our      │              │ claude/cursor/aider │
              │ codebase patterns?  │              │ manually, paste     │
              │                     │              │ task description.   │
              │ What if it breaks   │              │                     │
              │ things or creates   │              │ Or just do it       │
              │ tech debt?          │              │ yourself because    │
              │                     │              │ "faster than        │
              │ Cost of LLM calls   │              │ explaining."        │
              │ for long tasks?     │              │                     │
              └─────────────────────┘              └─────────────────────┘
```

**Insight:** The push is strong (manual context transfer is painful), and the pull is compelling (seamless delegation). The key anxiety to address is **agent competence** — the agent must demonstrate it understands the codebase via the MCP context packet. Cost anxiety is secondary and can be addressed with transparency.

---

## Job 2: Monitor Agent Progress

```
                    PUSH (frustration)                    PULL (desired future)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Black box: send     │              │ Real-time activity  │
              │ task, wait, hope.   │              │ feed showing file   │
              │                     │              │ changes, tool calls,│
              │ No way to know if   │              │ agent reasoning.    │
              │ agent is stuck in   │              │                     │
              │ a loop or making    │              │ Early warning if    │
              │ progress.           │              │ agent goes off      │
              │                     │              │ track.              │
              └─────────────────────┘              └─────────────────────┘

              ANXIETY (concerns)                   HABIT (current behavior)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Information overload│              │ Wait until agent    │
              │ — too much detail   │              │ finishes, then      │
              │ is as bad as none.  │              │ check git diff.     │
              │                     │              │                     │
              │ False sense of      │              │ Or: watch terminal  │
              │ security from       │              │ output scrolling    │
              │ watching without    │              │ by, skimming for    │
              │ understanding.      │              │ errors.             │
              └─────────────────────┘              └─────────────────────┘
```

**Insight:** The monitoring UI must be **concise by default** — show status and key events (file created, test passed, blocked), not raw agent logs. Expand-on-demand for power users.

---

## Job 3: Review and Accept Agent Output

```
                    PUSH (frustration)                    PULL (desired future)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Agent produces big  │              │ Structured review:  │
              │ diff with no        │              │ see what changed,   │
              │ context about why.  │              │ why, and what the   │
              │                     │              │ agent decided.      │
              │ Have to reconstruct │              │                     │
              │ agent reasoning     │              │ One-click accept    │
              │ from code alone.    │              │ to mark task done + │
              │                     │              │ commit/PR.          │
              └─────────────────────┘              └─────────────────────┘

              ANXIETY (concerns)                   HABIT (current behavior)
              ┌─────────────────────┐              ┌─────────────────────┐
              │ Missing bugs or     │              │ Manually review     │
              │ accepting low-      │              │ diffs in terminal   │
              │ quality code.       │              │ or GitHub PR view.  │
              │                     │              │                     │
              │ Agent made wrong    │              │ Run tests locally   │
              │ architectural       │              │ to verify.          │
              │ choices that are    │              │                     │
              │ hard to catch in    │              │ Copy-paste agent    │
              │ review.             │              │ output manually.    │
              └─────────────────────┘              └─────────────────────┘
```

**Insight:** The review flow must surface **agent reasoning** alongside the diff. The agent_session trace (already captured for PM agent) provides this — extend it to code agent sessions.
