# Journey: Create a New Learning with Agent Targeting

## Emotional Arc

```
Start: Intentional       Middle: Precise          End: Confident
"I want to teach my      "Specifying exactly      "Rule is active and
 agents a new rule"       what and for whom"        scoped correctly"
```

## Flow

```
+-- Learning Library -----------------------------------------------+
|                                                                    |
|  Learnings                                            [+ New]      |
|                                                       ^^^^^^^      |
+--------------------------------------------------------------------+
         |
         | (click + New)
         v
+-- Create Learning Dialog -----------------------------------------+
|                                                                    |
|  Create Learning                                                   |
|                                                                    |
|  What rule should agents follow?                                   |
|  +-------------------------------------------------------------+  |
|  | Never use `any` type in TypeScript. Use `unknown` for        |  |
|  | truly unknown types and narrow with type guards.             |  |
|  +-------------------------------------------------------------+  |
|                                                                    |
|  Type:                                                             |
|  ( ) constraint -- A hard rule agents must always follow           |
|  (o) instruction -- Guidance for how agents should approach work   |
|  ( ) precedent -- A pattern established by previous decisions      |
|                                                                    |
|  Priority: [medium v]                                              |
|                                                                    |
|  Applies to:                                                       |
|  (o) All agents                                                    |
|  ( ) Specific agents:                                              |
|      [ ] chat_agent  [ ] pm_agent  [ ] observer_agent  [ ] mcp    |
|                                                                    |
|                               [Cancel]  [Create Learning]          |
+--------------------------------------------------------------------+
         |
         | (click Create Learning)
         v
+-- Collision Detection Result -------------------------------------+
|                                                                    |
|  ! Potential collision detected:                                   |
|                                                                    |
|  Similar learning (89% match):                                     |
|  "Always use TypeScript strict mode"                               |
|  Status: active | Type: constraint | Agents: chat_agent, mcp      |
|                                                                    |
|  Your new learning may overlap with this existing rule.            |
|  Do you want to proceed?                                           |
|                                                                    |
|               [Go Back and Edit]  [Create Anyway]                  |
+--------------------------------------------------------------------+
         |
         | (click Create Anyway -- or no collision)
         v
+-- Success Toast ---------------------------------------------------+
|  Learning created and activated.                                   |
+--------------------------------------------------------------------+
```

## Emotional Annotations

| Step | Entry Emotion | Exit Emotion | Design Lever |
|------|---------------|--------------|--------------|
| Click "+ New" | Intentional | Focused | Clean form with clear labels and descriptions |
| Write learning text | Focused | Thoughtful | Textarea with sufficient space, no character limit shown initially |
| Choose type | Thoughtful | Precise | Radio buttons with inline descriptions explain each type |
| Set agent targeting | Precise | Deliberate | Default "All agents" is safe, specific selection is one click away |
| See collision warning | Deliberate | Cautious | Warning is informational, shows exactly what might conflict |
| Confirm creation | Cautious or Confident | Satisfied | Immediate activation, clear confirmation |

## Empty Form State

```
+-- Create Learning Dialog (initial) -------------------------------+
|                                                                    |
|  Create Learning                                                   |
|                                                                    |
|  What rule should agents follow?                                   |
|  +-------------------------------------------------------------+  |
|  | (placeholder: e.g., "Always validate user input before       |  |
|  |  processing" or "Use dependency injection for testability")  |  |
|  +-------------------------------------------------------------+  |
|                                                                    |
|  Type: (select one)                                                |
|  ( ) constraint   ( ) instruction   ( ) precedent                 |
|                                                                    |
|  Priority: [medium v]                                              |
|                                                                    |
|  Applies to: (o) All agents  ( ) Specific agents                  |
|                                                                    |
|                               [Cancel]  [Create Learning]          |
|                                          (disabled until           |
|                                           text + type filled)      |
+--------------------------------------------------------------------+
```
