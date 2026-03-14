# Journey: Define and Monitor Behavioral Standards

## Persona
**Elena Vasquez** -- Workspace Admin at a 4-person AI-augmented product team. Manages three coding agents and one design agent. Non-engineer background (product management). Comfortable with web UIs but does not write code. Wants her agents to exhibit "evidence-based reasoning" but has no way to measure it today.

## Journey Goal
Elena creates a behavior definition for "Evidence-Based Reasoning," activates it, watches scores flow in as agents work, reviews the trend dashboard, and adjusts the definition based on initial results.

## Emotional Arc
```
Start:       Curious + Slightly Overwhelmed
             "I know what I want to measure but not how to express it"
                |
                v
Step 2:      Guided + Gaining Confidence
             "The template is helping me think through this"
                |
                v
Step 3:      Anticipatory + Hopeful
             "Let's see if this actually works"
                |
                v
Step 4:      Validated + Satisfied
             "The scores are coming in and they make sense"
                |
                v
End:         Empowered + In Control
             "I can see the trend and I know how to adjust"
```

## Journey Flow

```
+--[1]--+     +--[2]--+     +--[3]--+     +--[4]--+     +--[5]--+
| Browse |---->| Create |---->|Activate|---->| Review |---->| Adjust |
| Library|     |  Def   |     |  Def   |     | Scores |     |  Def   |
+--------+     +--------+     +--------+     +--------+     +--------+
  ^                                              |              |
  |                                              v              |
  |                                         +--------+         |
  |                                         | Trend  |         |
  |                                         | Dashboard        |
  |                                         +--------+         |
  +-----<------<------<------<------<-------<-------<----------+
```

---

## Step 1: Browse the Behavior Library

**Action**: Elena navigates to the Behavior Library page from the main navigation.

```
+-- Behavior Library ------------------------------------------------+
|                                                                     |
|  Your Definitions (2 active)            [+ New Definition]          |
|                                                                     |
|  +-- TDD Adherence --------+   +-- Security First ---------+       |
|  | Deterministic | Active   |   | Deterministic | Active    |       |
|  | Avg: 0.82 | Trend: ^    |   | Avg: 0.91 | Trend: --    |       |
|  | 47 scores this week      |   | 12 scores this week       |       |
|  +--------------------------+   +----------------------------+       |
|                                                                     |
|  Community Templates (browse pre-built definitions)                 |
|                                                                     |
|  +-- Evidence-Based --------+   +-- Honesty ----------------+       |
|  | LLM-scored | Template    |   | LLM-scored | Template     |       |
|  | "Agents cite sources..." |   | "Agents do not fabricate."|       |
|  | [Use Template]            |   | [Use Template]            |       |
|  +--------------------------+   +----------------------------+       |
|                                                                     |
|  +-- Collaboration ---------+   +-- Conciseness ------------+       |
|  | LLM-scored | Template    |   | LLM-scored | Template     |       |
|  | "Agents coordinate..."   |   | "Agents avoid verbose..." |       |
|  | [Use Template]            |   | [Use Template]            |       |
|  +--------------------------+   +----------------------------+       |
+---------------------------------------------------------------------+
```

**Emotional State**: Curious. Elena sees her existing deterministic scorers alongside community templates. The "Evidence-Based Reasoning" template catches her eye.

**Shared Artifacts**: `${active_definition_count}`, `${community_template_list}`

---

## Step 2: Create a Behavior Definition

**Action**: Elena clicks [Use Template] on "Evidence-Based Reasoning" and customizes it.

```
+-- New Behavior Definition ------------------------------------------+
|                                                                      |
|  Title:    [Evidence-Based Reasoning                    ]            |
|                                                                      |
|  Category: [Integrity       v]                                       |
|                                                                      |
|  Goal (plain language):                                              |
|  +----------------------------------------------------------------+  |
|  | Agents must cite specific evidence (code references, docs,     |  |
|  | observations, or data) when making claims or recommendations.  |  |
|  | Unsupported assertions should receive low scores.              |  |
|  +----------------------------------------------------------------+  |
|                                                                      |
|  Scoring Logic (plain language):                                     |
|  +----------------------------------------------------------------+  |
|  | Score 0.9-1.0: Every claim has a specific citation              |  |
|  | Score 0.6-0.8: Most claims cited, minor gaps                    |  |
|  | Score 0.3-0.5: Some claims unsupported                          |  |
|  | Score 0.0-0.2: Fabricated claims or no evidence provided        |  |
|  +----------------------------------------------------------------+  |
|                                                                      |
|  Scoring Mode:  (o) LLM-scored  ( ) Deterministic                   |
|                                                                      |
|  Applies to telemetry types:                                         |
|  [x] chat_response  [x] decision_proposal  [ ] commit               |
|  [ ] tool_invocation  [x] observation_creation                       |
|                                                                      |
|  +-- Validation Preview -----------------------------------------+   |
|  | Definition parsed successfully.                                |   |
|  | Scoring rubric: 4 levels detected (0.0-0.2, 0.3-0.5,         |   |
|  |                  0.6-0.8, 0.9-1.0)                            |   |
|  | Applicable events: chat_response, decision_proposal,          |   |
|  |                    observation_creation                        |   |
|  +---------------------------------------------------------------+   |
|                                                                      |
|  [Save as Draft]                    [Activate]    [Cancel]           |
+----------------------------------------------------------------------+
```

**Emotional State**: Guided and gaining confidence. The template pre-filled sensible defaults. The validation preview confirms her definition was parsed correctly. The scoring rubric levels are explicit.

**Shared Artifacts**: `${definition_title}`, `${definition_goal}`, `${scoring_logic}`, `${scoring_mode}`, `${telemetry_types}`

---

## Step 3: Activate the Definition

**Action**: Elena clicks [Activate]. A confirmation appears.

```
+-- Activate Definition -----------------------------------------------+
|                                                                       |
|  Ready to activate "Evidence-Based Reasoning"                         |
|                                                                       |
|  Once active, the Scorer Agent will evaluate matching telemetry       |
|  events against this definition. Scores will appear in the            |
|  behavior dashboard within minutes of the next agent action.          |
|                                                                       |
|  Applicable telemetry: chat_response, decision_proposal,              |
|                        observation_creation                           |
|                                                                       |
|  Enforcement mode:  Scoring only (no automatic restrictions)          |
|                     You can enable enforcement later.                 |
|                                                                       |
|  [Activate Now]                                    [Keep as Draft]    |
+-----------------------------------------------------------------------+
```

**Emotional State**: Anticipatory and hopeful. The confirmation is clear about what will happen. "Scoring only (no automatic restrictions)" reduces anxiety.

**Shared Artifacts**: `${definition_status}` transitions from `draft` to `active`

---

## Step 4: Review Scores

**Action**: An hour later, Elena returns to check scores. Three agent actions have been scored.

```
+-- Evidence-Based Reasoning -- Scores --------------------------------+
|                                                                       |
|  Status: Active | 3 scores in last hour | Avg: 0.73                  |
|                                                                       |
|  +-- Score Timeline -----------------------------------------------+  |
|  |  1.0 |                                                          |  |
|  |  0.8 |  *              *                                        |  |
|  |  0.6 |                          *                               |  |
|  |  0.4 |                                                          |  |
|  |  0.2 |                                                          |  |
|  |  0.0 +--+-------+-------+-------+-------+-------+----> time    |  |
|  |        10:15    10:42    11:08                                  |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
|  Recent Scores:                                                       |
|                                                                       |
|  +-- 11:08 -- coding-agent-alpha -- Score: 0.62 --------[Details]-+  |
|  | Action: chat_response in project "Brain v4"                     |  |
|  | Rationale: "Agent recommended tRPC migration but cited only     |  |
|  |  one supporting decision node. Two claims about performance     |  |
|  |  gains lacked specific benchmarks or references."               |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
|  +-- 10:42 -- coding-agent-beta -- Score: 0.85 ---------[Details]-+  |
|  | Action: decision_proposal in project "Auth Service"             |  |
|  | Rationale: "All three alternatives cited with specific          |  |
|  |  trade-offs. Cost estimates referenced vendor pricing pages.    |  |
|  |  Minor gap: no citation for latency claim."                     |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
|  +-- 10:15 -- design-agent -- Score: 0.81 ---------------[Details]-+ |
|  | Action: observation_creation in project "Brain v4"              |  |
|  | Rationale: "Observation cited 3 specific graph nodes as         |  |
|  |  evidence. Severity assessment grounded in trend data."         |  |
|  +----------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
```

**Emotional State**: Validated and satisfied. The scores make sense. The rationale explains WHY each score was given. Elena can see that coding-agent-alpha needs improvement.

**Shared Artifacts**: `${score_value}`, `${score_rationale}`, `${acting_identity}`, `${action_type}`, `${score_timestamp}`

---

## Step 5: Adjust the Definition

**Action**: Elena notices that the scoring logic is too strict about citing every claim. She edits the definition.

```
+-- Edit: Evidence-Based Reasoning ------------------------------------+
|                                                                       |
|  Scoring Logic (updated):                                             |
|  +----------------------------------------------------------------+  |
|  | Score 0.9-1.0: Key claims have specific citations               |  |
|  | Score 0.6-0.8: Most key claims cited, minor gaps acceptable     |  |
|  | Score 0.3-0.5: Key claims missing evidence                      |  |
|  | Score 0.0-0.2: Fabricated claims or no evidence provided        |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
|  Change summary: Relaxed top tier from "every claim" to "key         |
|  claims." Added "minor gaps acceptable" to second tier.              |
|                                                                       |
|  Impact: Scores for actions matching this definition may shift       |
|  upward. Existing scores are preserved (append-only).                |
|                                                                       |
|  [Save Changes]                                      [Cancel]        |
+-----------------------------------------------------------------------+
```

**Emotional State**: Empowered and in control. Elena refined her definition based on real results. The system showed her the impact of her change clearly.

**Shared Artifacts**: `${scoring_logic}` updated, `${definition_version}` incremented

---

## Error Paths

### E1: Ambiguous Definition
Elena writes a goal that is too vague: "Agents should be good." The validation preview warns:
```
  Warning: Goal is too broad for consistent scoring.
  Consider specifying what "good" means with concrete examples.
  Tip: Describe the observable evidence you would look for.
```

### E2: No Matching Telemetry
Elena activates a definition but no agent actions match the configured telemetry types for 24 hours:
```
  "Evidence-Based Reasoning" has been active for 24 hours
  with no matching telemetry events.
  Check: are the selected telemetry types correct?
  Selected: chat_response, decision_proposal, observation_creation
  Recent workspace activity: 12 commits, 3 tool_invocations (not selected)
```

### E3: Scorer Agent Failure
The Scorer Agent fails to score a telemetry event (LLM timeout, malformed response):
```
  Scoring failed for event at 14:22 (coding-agent-alpha, chat_response)
  Reason: Scorer Agent timeout after 30s
  Action: Event queued for retry. No score recorded.
  This does not affect the agent's existing scores or capabilities.
```

### E4: Conflicting Definitions
Elena creates a definition that overlaps with an existing one:
```
  Potential conflict detected:
  "Evidence-Based Reasoning" overlaps with "Documentation Quality"
  Both score chat_response events for citation quality.
  This may produce redundant or contradictory scores.
  [Proceed Anyway]  [Edit to Differentiate]  [Cancel]
```
