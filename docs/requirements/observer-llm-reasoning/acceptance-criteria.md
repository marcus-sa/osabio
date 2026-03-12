# Acceptance Criteria: Observer LLM Reasoning

## AC-1: Semantic Verification Pipeline (US-1, US-2)

### AC-1.1: LLM detects semantic contradiction on task completion
```gherkin
Given a workspace with a confirmed decision "minimize external dependencies"
And a task "add Redis caching and Kafka event stream" linked to the same project
When the task status transitions to "completed"
Then the observer loads confirmed/provisional decisions for the task's project (max 20, by recency)
And invokes the LLM with entity context and decision text
And the LLM returns a structured verdict with verdict = "mismatch" and confidence >= 0.5
And an observation is created with:
  | field             | value         |
  | severity          | conflict      |
  | observation_type  | contradiction |
  | source_agent      | observer_agent|
  | verified          | false         |
  | source            | llm           |
And observes edges link the observation to the task AND the contradicted decision
And the observation text contains "contradicts" or "conflicts" and references both entities
```

### AC-1.2: No contradiction creates match observation
```gherkin
Given a confirmed decision "use TypeScript for all backend services"
And a task "implement auth middleware in TypeScript" linked to the same project
When the task status transitions to "completed"
Then the LLM returns verdict = "match" with confidence >= 0.5
And an observation is created with severity "info" and verified true
```

### AC-1.3: High-confidence deterministic match skips LLM (when enabled)
```gherkin
Given OBSERVER_SKIP_DETERMINISTIC is "true" (or unset, as true is the default)
And a task with a linked commit
And the commit has passing CI from GitHub
When the deterministic verification returns "match"
Then the LLM reasoning step is not invoked (zero LLM API calls)
And the observation is created with source "github" (not "llm")
```

### AC-1.3b: Skip optimization disabled forces LLM on every event
```gherkin
Given OBSERVER_SKIP_DETERMINISTIC is "false"
And a task with a linked commit
And the commit has passing CI from GitHub
When the deterministic verification returns "match"
Then the LLM reasoning step is still invoked
And the observation is created with source "llm"
And the LLM verdict may confirm the match or detect a semantic contradiction the deterministic check missed
```

### AC-1.4: LLM failure falls back to deterministic verdict
```gherkin
Given the LLM service returns an error (timeout >10s, HTTP 500, rate limit)
Then the pipeline creates an observation using the deterministic verdict
And the observation source is "deterministic_fallback"
And no error is propagated to the caller (HTTP 200 response)
```

### AC-1.5: Low confidence downgrades to inconclusive
```gherkin
Given the LLM returns a verdict with confidence < 0.5
Then the observation verdict is "inconclusive"
And the severity is "info" (not "conflict")
And the observation is still created (not discarded)
```

### AC-1.6: Invalid evidence refs are stripped by post-validation
```gherkin
Given the LLM returns evidence_refs containing ["task:existing123", "decision:nonexistent456"]
Then post-validation strips "decision:nonexistent456" (does not resolve in workspace)
And the observation is created with evidence_refs containing only "task:existing123"
```

### AC-1.7: Decision confirmation checks against completed tasks
```gherkin
Given 2 completed tasks in project P: "implement billing REST API" and "add GraphQL gateway"
When decision "standardize on tRPC for all endpoints" is confirmed in project P
Then the observer loads both completed tasks
And the LLM evaluates each against the decision
And creates contradiction observations for each misaligned task
Verifiable: SELECT count() FROM observation WHERE source_agent = "observer_agent"
  AND observation_type = "contradiction" AND source = "llm" => 2
```

## AC-2: Pattern Synthesis (US-3a, US-3b)

### AC-2.1: Anomalies passed to LLM after deterministic scan
```gherkin
Given a workspace scan finds 5 anomalies (2 contradictions, 2 stale blockers, 1 drift)
Then all 5 anomalies are passed to the LLM synthesis step
And the LLM returns 0 or more named patterns from the controlled vocabulary
```

### AC-2.2: Pattern requires minimum 2 contributing entities
```gherkin
Given the LLM proposes a pattern with only 1 contributing entity
Then that pattern is discarded
And no synthesis observation is created for it
```

### AC-2.3: Pattern observation links to all contributing entities
```gherkin
Given the LLM identifies a "bottleneck_decision" pattern
With contributing entities [decision:D1, task:T1, task:T2, task:T3]
Then an observation is created with observation_type "pattern"
And 4 observes edges link the observation to D1, T1, T2, T3
Verifiable: SELECT count() FROM observes WHERE in = $obs_id => 4
```

### AC-2.4: Deduplication prevents repeated pattern observations
```gherkin
Given an open observation with observation_type "pattern" linking to [decision:D1, task:T1, task:T2]
When a new scan detects the same pattern for the same entities
Then no duplicate observation is created
Verifiable: run scan twice, SELECT count() FROM observation
  WHERE observation_type = "pattern" AND status = "open" => unchanged after second scan
```

### AC-2.5: Empty anomaly list skips LLM
```gherkin
Given a workspace scan finds 0 anomalies
Then the LLM synthesis step is not invoked (zero LLM API calls)
And the scan returns an empty result
```

### AC-2.6: LLM synthesis failure returns anomalies without patterns
```gherkin
Given a workspace scan finds 3 anomalies
And the LLM synthesis call fails
Then the 3 anomalies are returned as individual observations (current behavior)
And no synthesis pattern observations are created
```

### AC-2.7: Large workspace partitions anomalies
```gherkin
Given a workspace scan finds 60 anomalies (25 contradictions, 20 stale blockers, 15 drift)
Then anomalies are partitioned by type
And top 20 per type (by recency) are sent to LLM synthesis
And remaining anomalies are reported as individual standard observations
```

## AC-3: Peer Review (US-4)

### AC-3.1: LLM evaluates observation reasoning quality
```gherkin
Given pm_agent creates an observation "task 'implement rate limiting' is at risk"
And the observation has observes edges to task:T1 and decision:D1
When the observation_peer_review EVENT fires
Then the observer loads the observation, task T1, and decision D1
And the LLM evaluates whether the claim follows from the evidence
And returns a structured verdict: "sound" (confidence >= 0.7), "questionable" (0.4-0.7), or "unsupported" (<0.4)
```

### AC-3.2: Review creates linked observation with verdict
```gherkin
Given the LLM peer review returns verdict "sound" with confidence 0.82
Then a new observation is created by observer_agent with:
  | field             | value                    |
  | source_agent      | observer_agent           |
  | source            | llm                      |
  | observation_type  | validation               |
And an observes edge links the review observation to the reviewed observation
And the text describes the review finding with the verdict
```

### AC-3.3: Original observation is not modified
```gherkin
Given a peer review completes
Then the original observation's text, severity, status, and observes edges are unchanged
Verifiable: SELECT * FROM $original_obs before and after review — identical
```

## AC-4: Configuration (US-5)

### AC-4.1: OBSERVER_MODEL configures LLM
```gherkin
Given OBSERVER_MODEL is set to "anthropic/claude-haiku-4-5-20251001"
When the observer invokes LLM reasoning
Then the API call uses model "anthropic/claude-haiku-4-5-20251001"
```

### AC-4.2: Missing OBSERVER_MODEL disables LLM reasoning
```gherkin
Given OBSERVER_MODEL is not set in the environment
When the observer verification pipeline runs
Then only deterministic verification is performed
And zero LLM API calls are made
```

### AC-4.3: Model uses existing inference provider
```gherkin
Given INFERENCE_PROVIDER is "openrouter"
And OBSERVER_MODEL is set
Then the observer uses the OpenRouter client for LLM calls
```
