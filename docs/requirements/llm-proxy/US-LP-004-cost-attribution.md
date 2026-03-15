# US-LP-004: Cost Attribution and Spend Tracking

## Problem
Marcus Olsson is a workspace admin who manually checks Anthropic's billing dashboard to understand costs, then estimates allocation across projects by reviewing session timestamps. This takes 30+ minutes per week and is inaccurate. He cannot answer "how much did the auth-service refactor cost?" without guesswork.

## Who
- Workspace Admin | Manages budgets across projects | Needs per-project and per-task cost breakdowns automatically

## Job Story Trace
- JS-1: Transparent Cost Visibility

## Solution
Compute exact cost from each LLM call's token usage and model-specific pricing, then maintain running spend counters at workspace, project, and task granularity. Expose counters via API for dashboard consumption.

## Domain Examples

### 1: Happy Path -- Marcus sees per-project cost breakdown
Over the past week, Priya made 342 LLM calls attributed to project "auth-service" (total: $89.20) and 187 calls attributed to project "llm-proxy" (total: $42.50). The Observer agent made 45 calls attributed to project "observer-patterns" (total: $15.80). Marcus opens the spend dashboard and sees this breakdown instantly -- no manual calculation needed.

### 2: Happy Path -- Cost computed with cache efficiency
Priya's session has high cache hit rates (70% of input tokens are cache reads). For a Sonnet 4 call with 12,340 input tokens (8,200 cache read, 4,140 regular) and 2,100 output tokens: cost = (4,140 * $3.00 + 8,200 * $0.30 + 2,100 * $15.00) / 1,000,000 = $0.012 + $0.002 + $0.032 = $0.046. The trace records this exact cost.

### 3: Edge Case -- Unattributed costs roll up to workspace only
Some LLM calls lack task or project attribution (no X-Brain-Task header, task not linked to a project). These costs appear in the workspace total but under an "unattributed" category in the project breakdown. Marcus can see how much is unattributed and investigate which sessions need better attribution.

### 4: Edge Case -- Model pricing changes mid-month
Anthropic announces a price reduction effective March 10. Marcus updates the pricing table. Calls before March 10 use old prices; calls after use new prices. The spend dashboard accurately reflects both pricing periods because each trace records the cost computed at the time of the call.

## UAT Scenarios (BDD)

### Scenario: Cost computed from Sonnet 4 streaming response
Given a streaming response completes with model "claude-sonnet-4"
And input_tokens=12340, output_tokens=2100, cache_creation_tokens=0, cache_read_tokens=8200
When the proxy computes cost
Then cost_usd = ((12340 - 8200) * 3.00 + 8200 * 0.30 + 2100 * 15.00) / 1000000
And the computed cost is stored in the llm_trace node

### Scenario: Cost computed from Haiku non-streaming response
Given a non-streaming response completes with model "claude-haiku-3.5"
And input_tokens=500, output_tokens=100, no cache tokens
When the proxy computes cost
Then cost_usd = (500 * 0.80 + 100 * 4.00) / 1000000
And the computed cost is $0.0008

### Scenario: Spend counters updated at all granularities
Given a call costs $0.046 attributed to workspace "brain-v1", project "auth-service", task "implement-oauth"
When spend counters are updated
Then workspace "brain-v1" daily spend increases by $0.046
And project "auth-service" spend increases by $0.046
And task "implement-oauth" spend increases by $0.046

### Scenario: Unattributed costs visible in workspace total
Given 10 LLM calls totaling $5.00 have no task attribution
And 50 LLM calls totaling $45.00 have full attribution
When Marcus queries the workspace spend breakdown
Then workspace total shows $50.00
And the breakdown shows $45.00 attributed across projects
And $5.00 listed under "unattributed"

### Scenario: Spend API returns breakdown by project
Given Marcus queries GET /api/workspaces/brain-v1/proxy/spend?period=today
When the API responds
Then the response includes workspace total spend
And per-project breakdown with call count
And per-session breakdown with model, duration, and cost
And the response time is under 2 seconds

## Acceptance Criteria
- [ ] Cost computed from model-specific pricing table using input, output, cache_create, and cache_read token counts
- [ ] Spend counters maintained at workspace, project, and task granularity
- [ ] Unattributed costs visible as a separate category in spend breakdowns
- [ ] Spend API endpoint returns workspace/project/task breakdown with call counts
- [ ] Each trace records the exact cost computed at time of call (price changes do not retroactively alter historical costs)
- [ ] API response time under 2 seconds for spend queries

## Technical Notes
- Pricing table as a configuration object (not a database table) -- updated via config change
- Spend counters can be running counters (fast reads) or computed from trace aggregation (consistent but slower)
- If running counters: reconciliation job must verify counters match SUM(cost_usd) from traces periodically
- API endpoint: GET /api/workspaces/:workspaceId/proxy/spend with query params: period (today/week/month/custom), groupBy (project/session/task)
- Consider SurrealDB aggregation: `SELECT math::sum(cost_usd) FROM llm_trace WHERE ->scoped_to->workspace = $ws GROUP BY ->attributed_to->task`

## Dependencies
- US-LP-003 (graph trace capture -- spend is derived from trace data)
- US-LP-002 (identity resolution -- attribution requires workspace/task identity)
