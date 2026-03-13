# Journey: Edit or Deactivate an Active Learning

## Emotional Arc

```
Start: Concerned         Middle: Surgical         End: Relieved
"This learning is        "I can fix this          "Corrected without
 causing problems"        precisely"               side effects"
```

## Flow: Edit

```
+-- Learning Detail (expanded card) --------------------------------+
|                                                                    |
|  "Always use TypeScript strict mode"                               |
|                                                                    |
|  Type: constraint     Priority: high      Status: active           |
|  Source: human         Created: 2026-02-14 by Marcus               |
|  Applies to: chat_agent, mcp                                      |
|                                                                    |
|  [Edit]  [Deactivate]                                              |
+--------------------------------------------------------------------+
         |
         | (click Edit)
         v
+-- Edit Dialog ----------------------------------------------------+
|                                                                    |
|  Edit Learning                                                     |
|                                                                    |
|  Text:                                                             |
|  +-------------------------------------------------------------+  |
|  | Always use TypeScript strict mode in all new files.          |  |
|  | Existing JavaScript files should be migrated incrementally. |   |
|  +-------------------------------------------------------------+  |
|                                                                    |
|  Type: [constraint v]   Priority: [high v]                         |
|                                                                    |
|  Applies to:                                                       |
|  [x] chat_agent  [x] mcp  [ ] pm_agent  [ ] observer_agent       |
|                                                                    |
|                               [Cancel]  [Save Changes]             |
+--------------------------------------------------------------------+
         |
         | (click Save Changes)
         v
+-- Success Toast ---------------------------------------------------+
|  Learning updated successfully.                                    |
+--------------------------------------------------------------------+
```

## Flow: Deactivate

```
+-- Learning Detail (expanded card) --------------------------------+
|                                                                    |
|  "Prefer functional composition over class hierarchies"            |
|                                                                    |
|  Type: instruction    Priority: medium    Status: active            |
|  Source: agent (observer_agent)  Approved: 2026-03-02              |
|  Applies to: All agents                                            |
|                                                                    |
|  [Edit]  [Deactivate]                                              |
+--------------------------------------------------------------------+
         |
         | (click Deactivate)
         v
+-- Deactivation Confirmation Dialog --------------------------------+
|                                                                    |
|  Deactivate Learning                                               |
|                                                                    |
|  "Prefer functional composition over class hierarchies"            |
|                                                                    |
|  This learning currently applies to: All agents                    |
|                                                                    |
|  Deactivating will stop this rule from being injected into         |
|  agent prompts. The learning will be preserved in the              |
|  Deactivated tab and can be reactivated later.                     |
|                                                                    |
|  This is not a deletion. The learning and its audit trail          |
|  are preserved.                                                    |
|                                                                    |
|                          [Cancel]  [Deactivate]                    |
+--------------------------------------------------------------------+
         |
         | (click Deactivate)
         v
+-- Success Toast ---------------------------------------------------+
|  Learning deactivated. Agents will no longer follow this rule.     |
+--------------------------------------------------------------------+
```

## Emotional Annotations

| Step | Entry Emotion | Exit Emotion | Design Lever |
|------|---------------|--------------|--------------|
| Notice bad agent behavior | Concerned, frustrated | Motivated to fix | N/A (happens outside this journey) |
| Find the learning via browse/filter | Motivated | Focused | Filters narrow to relevant learnings quickly |
| Expand learning detail | Focused | Assessing | Full context confirms this is the right one |
| Click Edit | Assessing | Surgical | Edit dialog shows current values, change only what is needed |
| Save changes | Surgical | Relieved | Success confirmation, learning immediately updated |
| Click Deactivate | Assessing | Cautious | Confirmation dialog explains scope of impact |
| Confirm deactivation | Cautious | Relieved | Clear message that deactivation is reversible |
