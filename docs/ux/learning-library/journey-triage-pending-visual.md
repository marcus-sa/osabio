# Journey: Inline Pending Actions in Library

## Design Decision

The governance feed is the **notification layer** (push) for pending learnings. The library is the **management layer** (pull). Both surfaces offer the same approve/dismiss actions via shared dialog components.

## Emotional Arc

```
Start: Browsing               Middle: Noticing              End: Acting
"I'm reviewing all            "This one is pending,         "Approved/dismissed
 my learnings"                 let me handle it now"          without leaving"
```

## Flow: Approve Inline

```
+-- Learning Library (unfiltered) ---------------------------------+
|                                                                   |
|  Status: [All v]  Type: [All v]  Agent: [All v]                  |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | "Always use RecordId objects from surrealdb SDK"             | |
|  | [active] constraint | high | mcp, chat_agent                | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | "Avoid module-level mutable singletons for caching"          | |
|  | [pending] instruction | medium | mcp                         | |
|  | suggested by: observer_agent | confidence: 87%               | |
|  |                                     [Approve] [Dismiss]      | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | "Use snake_case for database field names"                    | |
|  | [active] instruction | low | All agents                     | |
|  +-------------------------------------------------------------+ |
+-------------------------------------------------------------------+
        |
        | (click Approve)
        v
+-- Approve Dialog ------------------------------------------------+
|                                                                   |
|  Approve Learning                                                 |
|                                                                   |
|  +-- Text (editable) ----------------------------------------+  |
|  | Avoid module-level mutable singletons for caching.         |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Type: instruction    Priority: [medium v]                        |
|  Applies to: [mcp]                                                |
|                                                                   |
|  (collision warning appears here if detected)                     |
|                                                                   |
|                           [Cancel]  [Approve as Active]           |
+-------------------------------------------------------------------+
        |
        | (click Approve as Active)
        v
+-- Toast ---------------------------------------------------------+
|  Learning approved and activated.                                 |
+-------------------------------------------------------------------+
        |
        v
(Card badge updates from [pending] to [active], action buttons removed)
```

## Flow: Dismiss Inline

```
+-- Pending card with Dismiss clicked -----------------------------+
|                                                                   |
|  Dismiss Learning                                                 |
|                                                                   |
|  "Use RecordId objects instead of string IDs in queries"          |
|                                                                   |
|  Reason (required):                                               |
|  +------------------------------------------------------------+  |
|  | Already covered by existing active learning                 |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|                           [Cancel]  [Dismiss]                     |
+-------------------------------------------------------------------+
        |
        | (click Dismiss)
        v
+-- Toast ---------------------------------------------------------+
|  Learning dismissed.                                              |
+-------------------------------------------------------------------+
        |
        v
(Card badge updates to [dismissed], or removed if filtered to non-dismissed)
```

## Emotional Annotations

| Step | Entry Emotion | Exit Emotion | Design Lever |
|------|---------------|--------------|--------------|
| Browsing library, see pending card | Neutral | Aware | Pending badge + action buttons make it obvious without creating urgency |
| Read pending card context | Aware | Evaluating | Source agent + confidence shown inline — no need to open a detail view |
| Click Approve | Evaluating | Confident | Dialog allows optional edit; collision warning is informational, not blocking |
| Click Dismiss | Evaluating | Deliberate | Reason field ensures thoughtful dismissals |
| See toast confirmation | Acting | Satisfied | Card updates in place — no page reload or navigation |

## Key Difference from Feed

| Aspect | Feed | Library |
|--------|------|---------|
| Discovery | Push — pending card appears in "Needs Review" | Pull — user filters/browses and encounters pending items |
| Context | Isolated card among other governance items | In context alongside active/dismissed learnings |
| After action | Card removed from feed | Card updates in place (badge changes) |
| Primary use | "What needs my attention?" | "What's the full picture?" |
