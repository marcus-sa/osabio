# US-03: "View Logic" Toggle for LLM Reasoning in Observation Detail

## Problem
Carla Navarro is a workspace admin who can now see that observations have reasoning stored (after US-01), but the observation detail page in the web UI does not expose this field. She still has to query the database directly to read reasoning. The "why" exists in the data but is not accessible in her normal workflow.

## Who
- Workspace admin | Investigating Observer findings in the web UI | Needs one-click access to LLM reasoning without leaving the observation detail page

## Solution
Add a "View Logic" toggle button to the observation detail view that expands a panel showing the LLM chain-of-thought reasoning, model identifier, and trace link. The panel handles three states: reasoning available, deterministic fallback (no LLM), and legacy observation (no reasoning field).

## Job Traces
- J1: Forensic Debugging (primary)
- J3: Audit/Compliance (secondary -- reasoning visible during compliance review)

## Domain Examples

### 1: Full Reasoning Available -- Carla investigates contradiction

Carla opens observation "observation:a1b2c3d4" (conflict severity, source: llm). She clicks "View Logic." The panel expands showing:
- Full reasoning text referencing task:i9j0k1l2 and decision:e5f6g7h8
- Model: "anthropic/claude-sonnet" (from linked trace)
- Trace link: "trace:x1y2z3" (clickable to view token count, cost, latency)

She reads the reasoning, confirms it is sound, and clicks "Acknowledge."

### 2: Deterministic Fallback -- No LLM reasoning exists

Carla opens observation "observation:det001" (info severity, source: deterministic_fallback). She clicks "View Logic." The panel shows:
- "Reasoning unavailable: verification used deterministic fallback (LLM call failed or was skipped)"
- Deterministic verdict: "match"
- Source: "CI status check -- all checks passing"

She understands why no LLM reasoning exists and moves on.

### 3: Legacy Observation -- Pre-feature observation

Carla opens observation "observation:old001" created 3 months ago (before this feature). She clicks "View Logic." The panel shows:
- "No reasoning recorded for this observation. Observations created before March 2026 do not include LLM chain-of-thought."
- Trace link shown as fallback if source_session linkage exists

## UAT Scenarios (BDD)

### Scenario: View Logic shows full reasoning for LLM-sourced observation
Given observation "observation:a1b2c3d4" has reasoning "The task Migrate billing..." and source "llm"
And the observation is linked to a trace via source_session
When Carla clicks "View Logic" on the observation detail page
Then a panel expands below the observation text
And the panel displays the full reasoning text
And the panel shows the model identifier from the linked trace
And the panel shows a clickable trace link

### Scenario: View Logic shows fallback for deterministic-sourced observation
Given observation "observation:det001" has no reasoning and source "deterministic_fallback"
When Carla clicks "View Logic"
Then the panel shows "Reasoning unavailable: verification used deterministic fallback"
And the deterministic verdict is displayed

### Scenario: View Logic shows empty state for legacy observation
Given observation "observation:old001" has no reasoning field (NONE)
And the observation was created before the reasoning feature
When Carla clicks "View Logic"
Then the panel shows "No reasoning recorded for this observation"
And a trace link is shown as fallback if available

### Scenario: View Logic toggle hides reasoning on second click
Given Carla has clicked "View Logic" and the reasoning panel is visible
When Carla clicks "Hide Logic"
Then the reasoning panel collapses
And the observation detail returns to its default compact view

### Scenario: Reasoning is not shown by default (internal telemetry)
Given Carla opens observation "observation:a1b2c3d4" with reasoning populated
When the observation detail page loads
Then the reasoning panel is collapsed by default
And only the observation text, severity, confidence, and evidence_refs are visible
And the "View Logic" button is visible as a toggle

## Acceptance Criteria
- [ ] "View Logic" toggle button visible on observation detail when user is workspace admin
- [ ] Reasoning panel collapsed by default (internal telemetry, not primary content)
- [ ] Panel shows full reasoning text when source is "llm" or "peer_review"
- [ ] Panel shows fallback message when source is "deterministic_fallback"
- [ ] Panel shows empty state message when reasoning is NONE (legacy observations)
- [ ] Panel shows model identifier and trace link when trace is available
- [ ] Panel handles missing trace gracefully

## Technical Notes
- Observation detail API endpoint needs to include `reasoning` field in response for admin users only
- Access control: reasoning field should be excluded from non-admin API responses (internal telemetry)
- Trace linkage: observation -> source_session -> invoked -> trace. May require an additional query or eager load.
- UI component: collapsible panel with monospace text formatting for reasoning (similar to code block)
- No new API endpoints needed -- extend existing observation detail response

## Dependencies
- US-01 (reasoning field must exist on observation records)
