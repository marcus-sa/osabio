# JTBD Job Stories: Task Status Ownership

## Job 1: Accurate Task Progress (Solo Developer)

**Job Story**: When I'm working solo on tasks using Claude Code locally, I want task status to reflect what's actually happening (agent started, code committed), so I can trust the task board without manually updating statuses.

### Dimensions
- **Functional**: Task status updates automatically based on real events (agent start, commit)
- **Emotional**: Confidence that the board reflects reality without babysitting
- **Social**: N/A (solo context)

## Job 2: Reliable Task Tracking (Team Lead)

**Job Story**: When my team has multiple agents working on tasks across branches, I want task completion to be tied to actual code landing in main, so I can trust that "completed" means verified and merged — not just that an agent said it finished.

### Dimensions
- **Functional**: Merge-to-main triggers completed status; push triggers done (pending review)
- **Emotional**: Trust that status reflects shipped reality, not agent optimism
- **Social**: Team can rely on task board as source of truth in standups

## Job 3: Graceful Recovery (Orchestrator Operator)

**Job Story**: When an agent crashes or produces rejected work, I want the task to automatically become available again, so I don't have stuck tasks blocking the pipeline.

### Dimensions
- **Functional**: Abort/reject resets task to "ready" so another agent can pick it up
- **Emotional**: No anxiety about orphaned in-progress tasks
- **Social**: Team doesn't see phantom "in progress" work
