# US-AL-003: JIT Learning Injection into Agent Prompts

## Problem
Tomas Eriksson has created 8 active learnings in his workspace, but agent prompts are static -- they load the same base prompt regardless of workspace history. Every new agent session starts from zero knowledge of workspace conventions. Tomas's coding agent used `null` again today despite the learning existing in the database, because nothing injects learnings into the prompt.

## Who
- System (prompt builder) | Agent session startup | Needs to inject relevant learnings into system prompts efficiently
- Tomas Eriksson (workspace owner) | Observes agent behavior | Wants agents to apply accumulated learnings from first interaction

## Job Story Trace
- **Job 3**: Runtime Learning Consumption
- **When** an agent starts a new session in a workspace with accumulated learnings, **I want to** have the right learnings injected into my system prompt, **so I can** operate with accumulated wisdom while keeping the context window efficient.

## Solution
At agent session start, query active learnings for the agent type and workspace, sort by priority (human > agent, high > low), enforce a token budget, and inject as a formatted "Workspace Learnings" section into the system prompt. Shared function callable from all prompt builders.

## Domain Examples

### 1: Happy Path -- Code agent session with 4 learnings
A new code_agent session starts in "Osabio Development." The system queries active learnings where target_agents includes "code_agent" and returns 4 records. They are sorted: 3 human-created first (constraint "null", instruction "--no-verify", precedent "integer cents"), then 1 agent-suggested (constraint "KNN two-step"). Total: ~300 tokens, within the 500-token budget. All 4 are injected as a "Workspace Learnings" section grouped by type (Constraints, Instructions, Precedents).

### 2: Edge Case -- Precedent injected only when contextually relevant
Workspace "Osabio Development" has a precedent learning "We migrated from MongoDB to PostgreSQL in Q3 2025" for the architect agent. When the architect starts a session about caching strategy, the precedent's embedding similarity to the current task context is 0.45 (below 0.70 threshold) -- the precedent is NOT injected. When the architect starts a session about database selection, similarity is 0.88 -- the precedent IS injected. Constraints and instructions are always injected regardless of context.

### 3: Edge Case -- Token budget exceeded
Workspace "Enterprise Project" has 8 constraints (300 tokens), 12 instructions (500 tokens), and 5 precedents (200 tokens) for code_agent. Token budget is 500. All 8 constraints are included first (always, even over budget). Remaining budget (200 tokens) fits 5 of 12 instructions (human-created first, then agent-suggested). No precedents fit. An observation is created: "Learning token budget exceeded. 7 instructions and 5 precedents dropped."

### 4: Error/Boundary -- No learnings for agent type
Workspace "Osabio Development" has 8 active learnings, but all target only code_agent. When pm_agent starts a session, the query returns zero results. No "Workspace Learnings" section is added to the PM agent prompt -- no empty section, no header, no mention.

## UAT Scenarios (BDD)

### Scenario: Active learnings injected into code_agent system prompt
Given workspace "Osabio Development" has 4 active learnings targeting code_agent
And 3 are human-created and 1 is agent-suggested
When a new code_agent session starts
Then buildSystemPrompt includes a "Workspace Learnings" section
And human-created learnings appear before agent-suggested
And learnings are grouped under Constraints, Instructions, and Precedents headings
And the section starts with "These rules were established by your workspace."

### Scenario: Learnings injected into MCP context packet
Given workspace "Osabio Development" has 4 active learnings targeting code_agent
When the MCP context builder prepares a context packet
Then the packet includes an "Active Learnings" section
And each learning is prefixed with a type tag: [constraint], [instruction], or [precedent]

### Scenario: Token budget enforced with agent-suggested learnings dropped first
Given 8 human-created learnings (500 tokens) and 4 agent-suggested learnings (400 tokens) for code_agent
And the learning section token budget is 500 tokens
When the system applies token budget
Then all 8 human-created learnings are included
And 0 agent-suggested learnings are included
And excluded learnings are logged

### Scenario: No learnings section when none apply
Given all active learnings target only code_agent
When a pm_agent session starts
Then no "Workspace Learnings" section appears in the system prompt

### Scenario: Precedents injected only when contextually relevant
Given a precedent learning "We migrated from MongoDB to PostgreSQL in Q3 2025" exists for architect
And the architect starts a session about "caching strategy for API layer"
When the system computes embedding similarity between the precedent and the task context
And similarity is 0.45 (below 0.70 threshold)
Then the precedent is NOT injected into the system prompt

### Scenario: Constraints always injected even over token budget
Given 8 constraint learnings (400 tokens) exist for code_agent
And the token budget is 300 tokens
When the system applies token budget
Then all 8 constraints are included (constraints are never dropped)
And an observation is logged noting budget exceeded by constraints alone

### Scenario: Conflicting learnings noted at injection time
Given human-created "Never use null" and agent-suggested "Return null from APIs" are both active
When the system detects semantic contradiction during injection
Then both are included with the human-created learning first
And a note is appended: "Conflict detected. Human-created rule takes priority."
And an observation is logged for governance review

## Acceptance Criteria
- [ ] Shared function `loadActiveLearnings(surreal, workspaceRecord, agentType)` queries and returns formatted learnings
- [ ] Learnings sorted: human-created before agent-suggested, then by priority (high > medium > low), then by created_at (older first)
- [ ] Type-based injection priority:
  - Constraints: ALWAYS injected regardless of token budget (hard rules, never dropped)
  - Instructions: Injected within remaining token budget after constraints (conditional, human before agent)
  - Precedents: Injected only when semantically relevant to current task context (embedding similarity > 0.70 against task/project description); dropped first when budget exceeded
- [ ] Token budget (~500 tokens) enforced: constraints always included, then instructions, then precedents; agent-suggested dropped before human-created within each tier
- [ ] Formatted as "Workspace Learnings" section with type groupings (Constraints, Instructions, Precedents)
- [ ] Injected into all 4 prompt builders: chat agent (buildSystemPrompt), PM agent (buildPmSystemPrompt), MCP (context-builder), Observer (context-loader)
- [ ] No section rendered when zero applicable learnings exist
- [ ] Budget overflow creates an observation for governance feed

## Technical Notes
- Injection points are in existing files: `context.ts`, `pm/prompt.ts`, `context-builder.ts`, `context-loader.ts`
- Token counting can use simple word-count heuristic (1 token ~ 0.75 words) rather than exact tokenizer
- Query uses existing workspace + status + field filter pattern (same as observation/suggestion queries)
- Learning section is appended after existing context sections (projects, decisions, observations) but before conversation history
- Must respect the SurrealDB KNN + WHERE bug: if learnings table has indexes, use the two-step query pattern

## Dependencies
- Depends on: US-AL-005 (Learning Schema) -- table must exist to query
- Depends on: US-AL-001 or US-AL-002 -- learnings must exist to inject
- Independent of: US-AL-004 (Governance Feed) -- injection works without governance UI
