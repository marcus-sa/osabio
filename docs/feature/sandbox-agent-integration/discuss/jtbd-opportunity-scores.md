# Opportunity Scoring: Sandbox Agent Integration

## Outcome Statements and Scores

Scoring method: team estimate (no user survey data available). Confidence: Medium.

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the likelihood of a coding agent compromising host state or other workspaces | 90% | 25% | 15.5 | Extremely Underserved |
| 2 | Minimize the time to recover a coding agent session after a transient failure | 85% | 10% | 16.0 | Extremely Underserved |
| 3 | Minimize the time to send follow-up prompts to a running coding agent | 90% | 0% | 18.0 | Extremely Underserved |
| 4 | Minimize the likelihood of untracked agent tool calls bypassing governance | 85% | 40% | 12.5 | Underserved |
| 5 | Minimize the time to switch between different coding agent types | 70% | 15% | 10.5 | Appropriately Served |
| 6 | Minimize the likelihood of losing session history after server restart | 80% | 10% | 14.0 | Underserved |
| 7 | Minimize the time to observe real-time coding agent activity in the governance feed | 75% | 35% | 10.5 | Appropriately Served |
| 8 | Minimize the time to configure sandbox isolation level for a workspace | 60% | 30% | 8.4 | Overserved |
| 9 | Minimize the likelihood of governance gaps between native and sandbox agents | 85% | 45% | 12.5 | Underserved |
| 10 | Minimize the time to provision a governed coding agent with correct MCP and proxy config | 80% | 20% | 14.0 | Underserved |

## Score Interpretation

### Top Opportunities (Score >= 15) -- Must Have

1. **Multi-turn session support** (18.0) -- Currently impossible (409 on prompt). The highest-scoring outcome by far. Maps to Job 3.
2. **Session restoration after failure** (16.0) -- Zero current capability. Maps to Job 4.
3. **Host isolation** (15.5) -- Current worktree-only isolation is inadequate. Maps to Job 1.

### Strong Opportunities (Score 12-15) -- Should Have

4. **Session persistence in graph** (14.0) -- Prerequisite for restoration. Maps to Job 6.
5. **Agent provisioning with governance config** (14.0) -- Eliminates CLI bundling requirement. Maps to Job 5.
6. **Governance parity** (12.5) -- Same governance for sandbox and native agents. Maps to Job 5.
7. **Tool call governance** (12.5) -- Ensure all MCP calls go through policy evaluation. Maps to Job 5.

### Appropriately Served (Score 10-12) -- Could Have

8. **Agent portability** (10.5) -- Strategic but not urgent. Maps to Job 2.
9. **Real-time event streaming** (10.5) -- Partial current capability. Maps to Job 7.

### Overserved (Score < 10) -- Won't Have (this iteration)

10. **Workspace sandbox configuration** (8.4) -- Local provider sufficient for now. Maps to Job 8.

## Data Quality Notes

- Source: team estimates based on research document analysis and current architecture gaps
- Sample size: single researcher assessment
- Confidence: Medium -- scores are relative rankings, not absolute
- Recommendation: validate with workspace admin and developer interviews in next iteration

## Prioritization Impact

The top three outcomes (multi-turn, restoration, isolation) all converge on the same architectural change: replacing Claude Agent SDK with SandboxAgent SDK in the orchestrator. This validates the integration approach as high-priority.

Session persistence (SurrealDB driver) is a prerequisite for restoration, making it a blocking dependency that should be in the walking skeleton despite its lower independent score.
