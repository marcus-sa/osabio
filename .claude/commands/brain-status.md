---
name: brain-status
description: Show current Brain knowledge graph context for this project
user_invocable: true
---

# /brain-status

Show the current project context from the Brain knowledge graph.

## Instructions

1. Call the `get_project_context` MCP tool with the current project ID
2. Display the results in a readable format:
   - Contested decisions (conflicts that need resolution)
   - Confirmed decisions (follow these)
   - Provisional decisions (follow but note for review)
   - Active tasks with status
   - Open questions
   - Recent changes
3. If there are contested decisions, highlight them prominently
4. Suggest next actions based on the context (e.g., "Task X is blocked by question Y")
