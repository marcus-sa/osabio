---
name: brain-start-task
description: Start working on a specific task from the Brain knowledge graph
user_invocable: true
args: task_id
---

# /brain-start-task <task_id>

Start a task-scoped session focused on a specific task.

## Instructions

1. Call `get_task_context` with the task_id to get task-scoped context
2. Display the task details: title, description, status, dependencies
3. Show existing subtasks (if a previous agent already decomposed this task — do NOT re-decompose)
4. Show sibling tasks (for awareness of parallel work)
5. Show related decisions and constraints
6. Call `update_task_status` to set the task to "in_progress" if it's currently "todo" or "ready"
7. If the task has no subtasks, analyze what needs to be done and offer to create subtasks via `create_subtask`
8. Begin implementation, using Brain MCP tools throughout:
   - `resolve_decision` when hitting implementation choices
   - `check_constraints` before adding dependencies or changing approaches
   - `create_provisional_decision` when making choices the graph doesn't cover
   - `ask_question` when genuinely uncertain
   - `update_task_status` as subtasks complete
