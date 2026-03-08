# Opportunity Scores: Task Status Ownership

| Job | Importance (1-10) | Current Satisfaction (1-10) | Opportunity Score | Priority |
|-----|-------------------|----------------------------|-------------------|----------|
| Accurate Task Progress (Solo) | 8 | 4 | 12 | High |
| Reliable Task Tracking (Team) | 9 | 3 | 15 | Highest |
| Graceful Recovery (Orchestrator) | 7 | 6 | 8 | Medium |

**Opportunity Score** = Importance + (Importance - Satisfaction)

## Analysis

- **Reliable Task Tracking** scores highest because teams currently have no distinction between "agent says done" and "code merged" — the commit processor doesn't touch status at all.
- **Accurate Task Progress** is high because the duplicate in_progress transition is actively confusing and the server's optimistic set creates orphaned states on crashes.
- **Graceful Recovery** scores lowest because abort/reject already work — they just need to stay server-owned rather than being removed.
