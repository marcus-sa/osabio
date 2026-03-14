# JTBD Job Stories: Dynamic Behavior Definitions

## Job 1: Define Behavioral Standards

### Job Story

**When** I am setting up governance for my autonomous agents and I realize that hardcoded metrics like TDD_Adherence and Security_First cannot capture the soft skills and cultural values that matter to my team,
**I want to** define what "good behavior" looks like in plain language -- describing goals, evidence criteria, and scoring logic without writing code,
**so I can** measure agent alignment with my team's values (honesty, thoroughness, collaboration) and evolve those standards as my organization's culture matures.

### Functional Job
Create, edit, activate, and retire behavior definitions that describe measurable standards in domain language. Browse a library of pre-built definitions. Import/export definitions across workspaces.

### Emotional Job
Feel empowered to shape agent culture without needing engineering expertise. Feel confident that the definitions I write will actually be evaluated consistently. Feel ownership over the governance model.

### Social Job
Be seen by my team as someone who sets clear, fair standards for agent behavior. Demonstrate to stakeholders that autonomous agents operate under explicit, auditable governance -- not just vibes.

### Job Map Steps

| Step | Goal | Desired Outcome |
|------|------|-----------------|
| Define | Determine which behavioral standard to create | Minimize the time to articulate a new value as a measurable behavior |
| Locate | Find existing definitions or templates to build from | Minimize the likelihood of creating a redundant or conflicting definition |
| Prepare | Draft the goal, evidence criteria, and scoring logic in plain language | Minimize the effort to express complex values in evaluatable terms |
| Confirm | Validate that the definition is clear enough for the Scorer Agent to evaluate | Minimize the likelihood of ambiguous definitions producing inconsistent scores |
| Execute | Activate the definition so it begins scoring agent actions | Minimize the time between defining a standard and seeing it enforced |
| Monitor | Review scores produced by the new definition across agents | Minimize the likelihood of a definition producing misleading scores undetected |
| Modify | Adjust scoring logic or thresholds based on initial results | Minimize the time to correct a definition that scores too harshly or too leniently |
| Conclude | Retire or archive a definition that no longer applies | Minimize the likelihood of stale definitions producing irrelevant scores |

---

## Job 2: Real-time Behavioral Auditing

### Job Story

**When** an agent performs an action that produces telemetry (a commit, a chat response, a tool invocation, a decision proposal),
**I want to** have that action automatically evaluated against all active behavior definitions by a specialized Scorer Agent that understands the plain-language goals,
**so I can** catch misalignment immediately -- seeing a score appear in seconds, not discovering a pattern of bad behavior weeks later during a manual review.

### Functional Job
Automatically intercept telemetry events, match them to relevant behavior definitions, invoke the Scorer Agent to produce a semantic score (0.0-1.0), and persist the result as a Behavior Node linked to the acting identity.

### Emotional Job
Feel assured that every agent action is being watched -- not by me personally, but by an automated system I trust. Feel relief that I do not need to manually audit agent outputs. Feel safe knowing the system catches things I would miss.

### Social Job
Demonstrate to auditors and stakeholders that every agent action has a provenance-traced behavioral score. Show the team that governance is continuous, not periodic.

### Job Map Steps

| Step | Goal | Desired Outcome |
|------|------|-----------------|
| Define | Determine which telemetry events trigger scoring | Minimize the likelihood of an agent action going unscored |
| Locate | Match incoming telemetry to relevant behavior definitions | Minimize the time to identify which definitions apply to a given action |
| Prepare | Assemble the scoring context: definition + telemetry + evidence | Minimize the likelihood of the Scorer Agent evaluating with incomplete context |
| Confirm | Validate that the telemetry shape is compatible with the definition | Minimize the likelihood of a malformed telemetry event producing a false score |
| Execute | Invoke the Scorer Agent to produce a semantic score | Minimize the time between action and score availability |
| Monitor | Track score consistency and Scorer Agent reliability | Minimize the likelihood of Scorer Agent hallucination going undetected |
| Modify | Adjust when the Scorer Agent produces scores that seem wrong | Minimize the time to diagnose and correct a scoring anomaly |
| Conclude | Archive telemetry and score for audit trail | Minimize the likelihood of losing provenance data for a scored action |

---

## Job 3: Behavioral Boundary Enforcement

### Job Story

**When** an agent's behavior scores indicate persistent misalignment -- multiple low scores on a definition like "Honesty" or "Evidence-Based Reasoning" --
**I want to** have the Authorizer Agent automatically restrict that agent's capabilities (narrow its OAuth scopes, block high-risk actions, require human approval),
**so I can** prevent damage while the root cause is diagnosed and fixed, without me needing to manually intervene in real-time or write custom policy rules for every failure mode.

### Functional Job
Integrate behavior scores into the existing policy evaluation pipeline so the Authorizer can use score thresholds and trends as predicates. When scores breach thresholds, automatically downgrade agent authority. When scores recover, restore authority. Surface the restriction and its cause in the admin feed.

### Emotional Job
Feel safe that the system has a "circuit breaker" -- a low-scoring agent cannot keep doing damage. Feel trust that restrictions are proportional and reversible. Feel relieved that I do not need to be online 24/7 to catch a rogue agent.

### Social Job
Demonstrate to the organization that autonomous agents have automatic guardrails. Show that the system self-corrects -- bad behavior leads to restricted access, which leads to diagnosis, which leads to a learning, which leads to recovery.

### Job Map Steps

| Step | Goal | Desired Outcome |
|------|------|-----------------|
| Define | Determine score thresholds that trigger restrictions | Minimize the likelihood of setting thresholds too tight (false positives) or too loose (missed violations) |
| Locate | Identify which agent's scores have breached thresholds | Minimize the time to detect a threshold breach |
| Prepare | Assemble the restriction context: scores, trend, affected scopes | Minimize the likelihood of restricting the wrong capabilities |
| Confirm | Validate that restriction is warranted (not a scoring anomaly) | Minimize the likelihood of a false positive restriction disrupting legitimate work |
| Execute | Apply the restriction via the Authorizer policy gate | Minimize the time between breach detection and capability restriction |
| Monitor | Track restricted agent behavior for recovery signals | Minimize the time a well-behaved agent stays unnecessarily restricted |
| Modify | Adjust restrictions when the agent shows improvement | Minimize the friction of restoring capabilities after recovery |
| Conclude | Document the restriction episode for audit and learning | Minimize the likelihood of the same root cause recurring without a preventive learning |

---

## Cross-Job Dependencies

```
Job 1 (Define Standards) --enables--> Job 2 (Real-time Auditing)
Job 2 (Real-time Auditing) --feeds--> Job 3 (Boundary Enforcement)
Job 3 (Boundary Enforcement) --triggers--> Observer (Learning Proposal)
Observer (Learning Proposal) --may-modify--> Job 1 (Define Standards)
```

The three jobs form a closed loop: define standards, score against them, enforce boundaries, learn from failures, refine standards. This is the "Reflex Circuit."
