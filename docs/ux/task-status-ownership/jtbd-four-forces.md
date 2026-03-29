# Four Forces Analysis: Task Status Ownership

## Job 1: Accurate Task Progress (Solo Developer)

| Force | Description |
|-------|-------------|
| **Push** (frustration) | Server sets in_progress on assignment AND agent sets it again via osabio-start-task — redundant. Server sets done on session accept, but commit is the real completion event. Status doesn't reflect reality. |
| **Pull** (desired future) | Task status updates driven by real events: agent actually starting work, code actually being committed. Single source of truth per transition. |
| **Anxiety** (adoption concern) | What if agent crashes before setting in_progress? Task stays in ready — but that's actually correct (no work started). |
| **Habit** (current behavior) | Relying on server to optimistically set status. Must trust that agents and hooks will do their job instead. |

## Job 2: Reliable Task Tracking (Team Lead)

| Force | Description |
|-------|-------------|
| **Push** | Session accept sets done, but code might not be merged yet. GitHub commit processor only creates relations, doesn't update status. No distinction between "work finished" and "verified/merged". |
| **Pull** | Two-phase completion: done (committed, pending review) and completed (merged to main). GitHub processor as remote authority for teams. |
| **Anxiety** | What if commit message doesn't include task refs? Task stays in_progress. Need convention enforcement. |
| **Habit** | Treating session accept as task completion. Must shift to commit-as-completion mental model. |

## Job 3: Graceful Recovery (Orchestrator Operator)

| Force | Description |
|-------|-------------|
| **Push** | If agent crashes after server set in_progress, task is stuck — no agent working on it, but status says otherwise. |
| **Pull** | Server only handles backward transitions (abort/reject → ready). Forward transitions owned by the entity doing the work. Clean separation. |
| **Anxiety** | None significant — server already handles abort/reject. This is the one area that stays server-owned. |
| **Habit** | Server owning all transitions. Must accept split ownership model. |
