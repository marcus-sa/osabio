---
name: osabio-status
description: Show current Osabio knowledge graph context for this project
user_invocable: true
---

# /osabio-status

Show the current project context from the Osabio knowledge graph.

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
