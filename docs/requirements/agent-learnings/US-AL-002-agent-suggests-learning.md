# US-AL-002: Agent Suggests a Behavioral Learning

## Problem
The Observer agent scans the knowledge graph and detects that coding agents have been corrected about the same pattern ("null vs undefined") across 3 separate sessions in 2 weeks. Currently, the Observer can only log observations -- it cannot propose persistent behavioral changes. The same corrections recur because there is no mechanism to convert detected patterns into permanent rules.

## Who
- Observer agent | Detects correction patterns across sessions | Wants to suggest persistent learnings for human approval
- PM agent | Detects workflow anti-patterns | Wants to suggest learnings for other agents (cross-agent coaching)

## Job Story Trace
- **Job 2**: Agent Self-Improvement
- **When** an agent notices it has been corrected on the same pattern three times, **I want to** suggest a behavioral learning, **so I can** prevent future failures without requiring human initiative.

## Solution
Enable agents (Observer, PM, Chat, and others) to create learning suggestions with status "pending_approval" that surface in the governance feed for human review. Suggestions include evidence references to the data sources that triggered them.

### Data Sources for Learning Detection

Three sources feed agent-suggested learnings, ordered by value and implementation priority:

1. **Conversation history (highest value, lowest cost)** — The chat agent detects user corrections in real-time from message content ("no, don't do that", "I told you to...", "stop using null"). The chat agent can call `suggest_learning` immediately during the conversation, capturing the correction while context is fresh. Evidence: the source message(s) containing the correction.

2. **Trace table (cross-session patterns)** — The observer agent scans `trace` records across sessions to detect repeated tool failures, recurring bad arguments, or performance regressions. Traces capture tool_name, input, output, and duration_ms per call. Evidence: the trace records showing the repeated pattern. **Gap**: trace table does not currently capture structured errors — tool failures are logged in observability only. Phase 1 works with output inspection; structured error capture is a future enhancement.

3. **Observation escalation (compound signals)** — When the observer creates 3+ observations about the same pattern (e.g., "null usage" flagged in 3 sessions), it escalates from observation to learning suggestion. Evidence: the observation records that formed the cluster.

## Domain Examples

### 1: Happy Path -- Chat agent detects correction in conversation
Tomas tells the chat agent: "No, we never use null — I've told you this before. Use optional fields." The chat agent recognizes this as a correction pattern (frustration + behavioral directive). It calls `suggest_learning` with text "Never use null for domain data values. Represent absence with omitted optional fields," confidence 0.92, target_agents ["code_agent", "chat_agent"], evidence_refs linking to the current message, and status "pending_approval." The suggestion appears in Tomas's governance feed as a yellow-tier card.

### 2: Edge Case -- Cross-agent coaching (PM suggests for coding agent)
The PM agent notices that coding agents consistently create tasks without linking them to parent features, causing orphaned work items. The PM creates a learning suggestion with suggested_by "pm_agent", target_agents ["code_agent"], text "When creating tasks, always link to parent feature via belongs_to relation," and confidence 0.78. The suggestion surfaces in the governance feed for Tomas to approve.

### 3: Happy Path -- Observer escalates observation cluster to learning
The Observer has created 3 separate observations about "null usage" across sessions on March 5, 8, and 11. On the third occurrence, it recognizes the cluster pattern and escalates: it creates a learning suggestion with evidence_refs linking to the 3 observation records, confidence 0.89, and status "pending_approval."

### 4: Happy Path -- Observer detects trace pattern
The Observer scans the trace table and finds that `create_work_item` tool calls failed 4 times in the last week — output shows missing `belongs_to` relation each time. It creates a learning suggestion: "When creating tasks, always link to parent feature via belongs_to relation," with evidence_refs linking to the 4 trace records.

### 5: Error/Boundary -- Pattern below threshold
The Observer detects only 2 observations about "RecordId string format" in the past 14 days -- below the 3-occurrence threshold. Instead of creating a learning suggestion, it logs an observation: "Emerging pattern: RecordId corrections (2 occurrences). Monitoring for recurrence." If a third observation appears, the Observer escalates to a learning suggestion.

## UAT Scenarios (BDD)

### Scenario: Chat agent detects user correction and suggests learning
Given Tomas sends message "No, we never use null — use optional fields instead"
And the chat agent classifies this as a behavioral correction
When the chat agent calls suggest_learning
Then a learning record is created with status "pending_approval"
And suggested_by is "chat_agent" and confidence >= 0.85
And evidence_refs link to the source message record

### Scenario: Observer escalates observation cluster to learning suggestion
Given the Observer has created observation:obs1 on March 5 about "null usage"
And observation:obs2 on March 8 about "null in API response"
And observation:obs3 on March 11 about "null contract violation"
When the Observer runs pattern detection with cluster threshold 3
Then a learning record is created with status "pending_approval"
And suggested_by is "observer" and confidence is 0.89
And evidence_refs link to the 3 observation records

### Scenario: Observer detects repeated tool failure pattern in traces
Given trace:t1 shows create_work_item failed with "missing belongs_to"
And trace:t2 shows create_work_item failed with "missing belongs_to"
And trace:t3 shows create_work_item failed with "missing belongs_to"
When the Observer scans traces for repeated failure patterns
Then a learning suggestion is created with evidence_refs linking to 3 trace records
And target_agents includes the agent types that produced the failures

### Scenario: Observer skips pattern covered by existing learning
Given an active learning "Never use null for domain data values" exists
And 3 corrections about null usage exist in the graph
When the Observer checks for existing coverage via embedding similarity
Then no new suggestion is created
And an observation is logged "Correction pattern matches existing active learning"

### Scenario: Pattern below suggestion threshold
Given only 2 corrections about "RecordId string format" exist in 14 days
When the Observer evaluates whether to suggest a learning
Then no learning suggestion is created
And an info-level observation is logged "Emerging pattern (2 occurrences). Monitoring."

### Scenario: Re-suggestion prevented for dismissed learning
Given Tomas dismissed a learning suggestion "Do not use axios" 3 days ago
And the Observer runs its pattern scan again and identifies the same axios issue
When the Observer queries dismissed learnings for the same target_agent
And finds the dismissed learning with embedding similarity 0.91 (above 0.85 threshold)
Then no new suggestion is created
And the Observer does not create an observation about the pattern

### Scenario: Rate limiting prevents suggestion spam
Given the Observer has already created 5 learning suggestions this week for workspace "Osabio Development"
And the weekly suggestion limit per agent per workspace is 5
When the Observer detects another pattern worth suggesting
Then no new suggestion is created
And an observation is logged "Suggestion rate limit reached for observer in workspace"

### Scenario: Cross-agent coaching suggestion
Given the PM agent detected coding agents create tasks without feature links
When the PM agent creates a learning suggestion
Then the learning has suggested_by "pm_agent" and target_agents ["code_agent"]
And status is "pending_approval"
And the suggestion surfaces in Tomas's governance feed

### Scenario: Pending suggestion appears in governance feed
Given an Observer learning suggestion with confidence 0.89 exists
When Tomas opens the governance feed
Then a yellow-tier card shows the suggestion text
And displays "Suggested by: Observer | Confidence: 89% | For: code_agent"
And shows evidence quotes from 3 sessions
And has Approve, Edit & Approve, and Dismiss buttons

## Acceptance Criteria
- [ ] Chat agent detects user corrections in conversation and can call `suggest_learning` in real-time
- [ ] Observer detects observation clusters when 3+ observations on same topic occur within 14 days and escalates to learning suggestion
- [ ] Observer scans trace table for repeated tool failure patterns (same tool + same error across 3+ traces)
- [ ] All suggestion sources create learning records with status "pending_approval", suggested_by, target_agents, confidence, evidence_refs, and embedding
- [ ] evidence_refs supports polymorphic references: message, trace, observation, and agent_session records
- [ ] Observer checks existing active learnings before suggesting (skips if covered, similarity > 0.80)
- [ ] Re-suggestion prevention: before creating a suggestion, agent queries dismissed learnings for same target_agent; skips if dismissed learning found with similarity > 0.85
- [ ] Rate limiting: max 5 suggestions per agent per workspace per week (configurable)
- [ ] Suggestions below confidence threshold of 0.70 are not created (logged as observations instead)
- [ ] Cross-agent coaching supported: any agent can suggest learnings for any other agent type
- [ ] Pending suggestions surface as yellow-tier governance feed cards with evidence and approval controls
- [ ] Evidence references are preserved and displayable in the governance feed

## Technical Notes

### Data source implementation details

1. **Conversation-based detection (chat agent)**: The chat agent uses LLM classification to detect correction patterns in user messages (frustration markers + behavioral directives). This is a tool call within the existing chat agent tool loop — no new infrastructure needed. Evidence: `record<message>`.

2. **Trace-based detection (observer)**: New scan type in the existing observer graph scan loop. Queries `trace` table grouped by tool_name, filters for repeated failures (inspects output field for error patterns). **Known gap**: traces don't capture structured errors — Phase 1 uses output text inspection; structured error capture is a future enhancement. Evidence: `record<trace>`.

3. **Observation escalation (observer)**: New scan type in observer loop. Groups open/acknowledged observations by embedding similarity clusters. When cluster size >= threshold, promotes to learning suggestion. Evidence: `record<observation>`.

### General notes
- Feed card rendering follows existing suggestion card pattern (same visual tier, similar controls)
- Learning suggestion reuses the same `learning` table with different `source` and `status` values (not a separate table)
- Suggestion threshold (3 occurrences, 14-day window, 0.70 confidence) should be configurable per workspace

## Dependencies
- Depends on: US-AL-005 (Learning Schema) -- schema must exist
- Depends on: US-AL-004 (Governance Feed) -- feed cards must render pending learnings
- Depends on: Observer agent existing graph scan infrastructure
- Enables: US-AL-001 implicitly (agent suggestions complement human creation)
