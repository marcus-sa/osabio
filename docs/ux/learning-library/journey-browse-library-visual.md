# Journey: Browse & Filter Learning Library

## Emotional Arc

```
Start: Uncertain        Middle: Oriented         End: Informed
"What are my agents     "I can see and filter    "I know exactly what
 following?"             everything"              rules are active"
```

## Flow

```
[Sidebar: "Learnings" nav link]
         |
         v
+-- Learning Library (default: Active tab) -------------------------+
|                                                                    |
|  Learnings                                            [+ New]      |
|                                                                    |
|  [Active (12)] [Pending (3)] [Dismissed] [Deactivated]            |
|                                                                    |
|  Filter: [Type: All v]  [Agent: All v]  [Source: All v]           |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | "Always use TypeScript strict mode"                           | |
|  | constraint | high | chat_agent, mcp | human                  | |
|  | Created 2026-02-14                                            | |
|  +--------------------------------------------------------------+ |
|  | "Prefer functional composition over class hierarchies"        | |
|  | instruction | medium | All agents | agent (observer)          | |
|  | Created 2026-03-01  Approved 2026-03-02                       | |
|  +--------------------------------------------------------------+ |
|  | "Database migrations must be wrapped in transactions"         | |
|  | constraint | high | mcp | human                               | |
|  | Created 2026-01-20                                            | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  Showing 3 of 12 active learnings                                  |
+--------------------------------------------------------------------+
         |
         | (click a learning card)
         v
+-- Learning Detail (inline expansion) -----------------------------+
|                                                                    |
|  "Always use TypeScript strict mode"                               |
|                                                                    |
|  Type: constraint     Priority: high      Status: active           |
|  Source: human         Created: 2026-02-14 by Marcus               |
|  Applies to: chat_agent, mcp                                      |
|                                                                    |
|  [Edit]  [Deactivate]                                              |
+--------------------------------------------------------------------+
```

## Emotional Annotations

| Step | Entry Emotion | Exit Emotion | Design Lever |
|------|---------------|--------------|--------------|
| Click "Learnings" in sidebar | Uncertain, curious | Oriented | Clear counts on tabs show scope immediately |
| Scan active learnings list | Oriented | Focused | Cards show key metadata at a glance -- type, priority, agents |
| Apply filters | Focused | Precise | Instant filtering, no page reload. Filter state in URL for sharing |
| Expand a learning | Precise | Informed | Full detail with clear actions available |
| Switch to Pending tab | Informed, curious | Engaged | Badge count drew attention, now seeing what needs triage |

## Empty State

```
+-- Learning Library (no learnings yet) ----------------------------+
|                                                                    |
|  Learnings                                            [+ New]      |
|                                                                    |
|  [Active (0)] [Pending (0)] [Dismissed] [Deactivated]             |
|                                                                    |
|  No learnings yet.                                                 |
|                                                                    |
|  Learnings are behavioral rules that shape how your AI agents      |
|  work. They can be created by you or suggested by agents.          |
|                                                                    |
|  [Create your first learning]                                      |
|                                                                    |
+--------------------------------------------------------------------+
```

## Filter Interaction Detail

```
Type dropdown:         Agent dropdown:         Source dropdown:
+-----------------+   +-----------------+     +-----------------+
| All types       |   | All agents      |     | All sources     |
| constraint      |   | chat_agent      |     | human           |
| instruction     |   | pm_agent        |     | agent           |
| precedent       |   | observer_agent  |     +-----------------+
+-----------------+   | mcp             |
                      +-----------------+
```

## Tab Switching (Pending)

```
+-- Learning Library (Pending tab) ---------------------------------+
|                                                                    |
|  Learnings                                            [+ New]      |
|                                                                    |
|  [Active (12)] [Pending (3)] [Dismissed] [Deactivated]            |
|                        ^^^                                         |
|  +--------------------------------------------------------------+ |
|  | "Avoid module-level mutable singletons for caching"           | |
|  | instruction | medium | mcp | suggested by: observer_agent     | |
|  | Confidence: 0.87 | Created 2026-03-12                         | |
|  |                                      [Approve] [Dismiss]      | |
|  +--------------------------------------------------------------+ |
|  | "Use RecordId objects instead of string IDs in queries"       | |
|  | constraint | high | mcp, chat_agent | suggested by: pm_agent  | |
|  | Confidence: 0.92 | Created 2026-03-11                         | |
|  |                                      [Approve] [Dismiss]      | |
|  +--------------------------------------------------------------+ |
+--------------------------------------------------------------------+
```
