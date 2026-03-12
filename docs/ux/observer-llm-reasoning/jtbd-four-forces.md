# Four Forces Analysis: Observer LLM Reasoning

## J1 — Semantic Contradiction Detection

| Force | Description |
|-------|-------------|
| **Push** (frustration) | String matching misses intent-level contradictions. "Minimize dependencies" vs "add 5 npm packages" passes undetected. Real contradictions go unnoticed until they cause production issues. |
| **Pull** (desired future) | LLM reads the intent behind decisions and constraints, compares against implementation evidence. Catches what a senior engineer reviewing the codebase would catch — but continuously. |
| **Anxiety** (adoption concerns) | LLM hallucination creates false contradictions, leading to alert fatigue. Per-verification cost adds up at scale. Latency increase on event-triggered pipeline. |
| **Habit** (current behavior) | Users rely on manual review during PR/code review. Subtle contradictions between decisions and implementation are ignored or discovered late. The deterministic observer catches only literal mismatches. |

## J2 — Reasoning-Quality Peer Review

| Force | Description |
|-------|-------------|
| **Push** | Current peer review checks field-level status only. A well-structured but logically wrong observation passes. No quality signal distinguishes sound observations from noise. |
| **Pull** | LLM evaluates whether the observation's claim follows from the evidence in the graph. Adds a "reviewed by reasoning agent" quality signal. |
| **Anxiety** | Observer disagreeing with other agents' observations could create confusion. LLM could incorrectly dismiss valid observations. Overhead of a second LLM call per observation. |
| **Habit** | Users treat all observations as equally credible. No triage mechanism beyond severity level. Manual investigation required to assess observation quality. |

## J3 — Cross-Signal Pattern Synthesis

| Force | Description |
|-------|-------------|
| **Push** | Graph scan finds individual anomalies in isolation. User must mentally correlate "3 tasks blocked on decision X" + "decision X has 2 conflicting observations" + "decision X is 30 days old" into "decision X is a systemic bottleneck." |
| **Pull** | LLM identifies named patterns: bottleneck decisions, cascading block chains, priority drift clusters, resource contention. Produces a synthesis observation linking all contributing signals. |
| **Anxiety** | Synthesized patterns could be speculative or overfit to coincidences. Distinguishing genuine insight from LLM confabulation requires grounding. Cost of scanning full workspace context through LLM. |
| **Habit** | Users do periodic manual triage, scanning the feed for clusters. Works at small scale (10-20 entities), breaks at 50+. Power users build mental models; casual users miss patterns entirely. |

## J4 — Contextual Natural Language Verdicts

| Force | Description |
|-------|-------------|
| **Push** | Template text is repetitive: "Task marked as completed but CI is failing for commit(s): abc1234." Users skim past it. No "so what" or recommended action. |
| **Pull** | Each observation reads like a brief: "Rate limiting task was marked complete, but commit abc1234 is failing CI — the test suite has 3 failing rate-limit integration tests. Consider reverting the status or fixing tests before the sprint review Thursday." |
| **Anxiety** | Verbose LLM output could be worse than templates — walls of text in the feed. Latency increase. Inconsistent tone across observations. |
| **Habit** | Users read observation text once on creation, then use severity/type badges for triage. Template text is "good enough" for the badge-scanning workflow. |
