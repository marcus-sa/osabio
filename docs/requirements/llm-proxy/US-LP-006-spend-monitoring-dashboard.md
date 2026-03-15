# US-LP-006: Spend Monitoring Dashboard

## Problem
Marcus Olsson is a workspace admin who currently has no way to monitor LLM spending in real-time. He checks Anthropic's billing dashboard weekly, which shows a single total with no project or agent breakdown. He cannot identify which project or agent session is consuming the most tokens, and by the time he notices an expensive session, the cost has already been incurred.

## Who
- Workspace Admin | Daily cost monitoring | Needs real-time spend visibility with drill-down by project, session, and task

## Job Story Trace
- JS-1: Transparent Cost Visibility

## Solution
A dashboard view in the Brain web UI showing workspace spend with progress bars against budget limits, per-project breakdown with call counts, per-session breakdown with model and duration, and anomaly alerts for unusual spending patterns.

## Domain Examples

### 1: Happy Path -- Marcus reviews daily spend at lunch
Marcus opens the LLM Proxy dashboard at noon. He sees: workspace daily spend $23.47 / $50.00 (47% progress bar). Project breakdown: auth-service $12.30 (342 calls), llm-proxy $8.17 (187 calls), observer-patterns $3.00 (45 calls). He notes auth-service is on track and closes the tab. Took 5 seconds to get the full picture.

### 2: Happy Path -- Marcus drills into an expensive session
Marcus notices session "priya/auth-refactor" cost $8.40 in 2.1 hours. He clicks to drill down. He sees 342 individual LLM traces sorted by cost: the most expensive call used 45,000 input tokens (a large file read loop). He identifies this as a debugging loop where Claude Code repeatedly read, edited, and tested the same file. He messages Priya with a suggestion to use a more targeted approach.

### 3: Anomaly Alert -- Unusual call rate detected
The anomaly detection system notices session "priya/auth-refactor" has made 342 calls in 2.1 hours (3x the average rate of 100 calls/2h). An alert card appears on Marcus's dashboard: "[!] Session priya/auth-refactor has 342 calls in 2.1h (3x average rate). Possible debugging loop detected." Marcus can [Investigate] (drill into the session) or [Dismiss] (acknowledge and close).

### 4: Edge Case -- Budget threshold alert
At 3:15 PM, workspace daily spend crosses the 80% threshold ($40.00 of $50.00). An alert fires: "80% of daily budget consumed ($40.00 / $50.00). At current rate, budget will be exhausted by 4:45 PM." Marcus sees this on the dashboard and decides to continue -- the remaining $10 covers the afternoon's work.

## UAT Scenarios (BDD)

### Scenario: Dashboard shows workspace spend with budget progress
Given Marcus navigates to the LLM Proxy spend overview for workspace "brain-v1"
And the daily budget is $50.00 and today's spend is $23.47
When the dashboard loads
Then Marcus sees a progress bar showing 47% of daily budget consumed
And the total spend "$23.47" and limit "$50.00" are displayed
And the dashboard loads within 2 seconds

### Scenario: Dashboard shows per-project spend breakdown
Given workspace "brain-v1" has traces attributed to 3 projects
When the project breakdown table loads
Then each row shows project name, today's spend, month-to-date spend, and call count
And projects are sorted by today's spend descending
And the sum of project spend plus unattributed equals the workspace total

### Scenario: Dashboard shows per-session breakdown
Given Marcus switches to the session cost view
When the session table loads
Then each row shows session identifier, total cost, primary model used, and duration
And sessions are sorted by cost descending
And Marcus can click any session to see its individual LLM traces

### Scenario: Anomaly alert appears for unusual spending
Given session "priya/auth-refactor" has 342 calls in 2.1 hours
And the average session rate is 100 calls per 2 hours
When the anomaly detector evaluates sessions
Then an alert card appears on the dashboard
And the alert describes "3x average call rate, possible debugging loop"
And the alert has [Investigate] and [Dismiss] action buttons

### Scenario: Budget threshold alert fires at 80%
Given workspace daily budget is $50.00 with alert threshold at 80%
When daily spend reaches $40.00
Then a budget alert card appears on the dashboard
And the alert shows current spend, limit, and projected exhaustion time

## Acceptance Criteria
- [ ] Dashboard shows workspace daily spend with progress bar against budget limit
- [ ] Per-project breakdown shows today, MTD, and call count
- [ ] Per-session breakdown shows cost, model, duration with drill-down to individual traces
- [ ] Anomaly alerts displayed for sessions exceeding 2x average call rate or spend rate
- [ ] Budget threshold alerts fire at configured percentage (default 80%)
- [ ] Dashboard loads within 2 seconds
- [ ] All figures derived from trace graph aggregation (single source of truth)

## Technical Notes
- API endpoints needed: GET /api/workspaces/:workspaceId/proxy/spend (workspace overview), GET /api/workspaces/:workspaceId/proxy/sessions (session list with cost), GET /api/workspaces/:workspaceId/proxy/sessions/:sessionId/traces (individual traces)
- Anomaly detection: compare session call rate and spend rate against rolling 7-day average; threshold: 2x for warning, 3x for alert
- Budget alerts: check spend against configured thresholds after each trace capture
- Consider caching aggregated spend data with short TTL (10s) to avoid expensive graph queries on every dashboard load
- Anomaly alerts integrate with Brain's existing observation system

## Dependencies
- US-LP-003 (graph trace capture -- dashboard reads from trace data)
- US-LP-004 (cost attribution -- dashboard displays computed costs)
