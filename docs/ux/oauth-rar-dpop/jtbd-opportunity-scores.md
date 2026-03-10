# Opportunity Scoring: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Scoring Method

- **Importance**: Team estimate (0-100%) of how critical this outcome is to the platform's security and usability
- **Satisfaction**: Team estimate (0-100%) of how well the current system addresses this outcome
- **Score**: Importance + max(0, Importance - Satisfaction)
- **Priority**: Extremely Underserved (15+), Underserved (12-15), Appropriately Served (10-12), Overserved (<10)
- **Data Quality**: Team estimates based on codebase analysis and architectural review. Confidence: Medium.

## Job 1: Actor Obtaining a Brain Operation Token

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|---|---|---|---|---|
| 1.1 | Minimize the likelihood of any actor holding broader privileges than needed for a specific Brain operation | 95% | 15% | 17.5 | Extremely Underserved |
| 1.2 | Minimize the likelihood of a leaked token being usable by an unauthorized entity | 95% | 10% | 17.5 | Extremely Underserved |
| 1.3 | Minimize the time it takes for an actor to obtain a Brain operation token | 70% | 60% | 8.0 | Overserved |
| 1.4 | Eliminate classification boundaries as a vulnerability surface | 98% | 0% | 19.6 | Extremely Underserved |
| 1.5 | Minimize the number of steps an actor developer must implement to obtain a Brain token | 65% | 50% | 8.0 | Overserved |
| 1.6 | Maximize the likelihood that token scope is auditable and machine-readable | 85% | 30% | 13.5 | Underserved |
| 1.7 | Ensure uniform authorization language (brain_action) across all actors and operations | 96% | 5% | 18.7 | Extremely Underserved |

## Job 2: Human Owner Authorizing/Constraining Agent Actions

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|---|---|---|---|---|
| 2.1 | Minimize the likelihood of a human approving an action they do not fully understand | 90% | 15% | 16.5 | Extremely Underserved |
| 2.2 | Ensure the Authorizer Agent evaluates Rich Intent Objects uniformly (never scopes) | 94% | 0% | 18.8 | Extremely Underserved |
| 2.3 | Maximize the likelihood that the human can constrain (not just allow/deny) an agent's request | 78% | 5% | 15.1 | Extremely Underserved |
| 2.4 | Minimize the time it takes for a human to review and decide on a pending authorization | 75% | 40% | 10.5 | Appropriately Served |
| 2.5 | Minimize the likelihood of missing a veto window for a high-risk action | 85% | 35% | 13.5 | Underserved |
| 2.6 | Maximize the likelihood that past authorization decisions are traceable and explainable | 88% | 20% | 14.8 | Underserved |

## Job 3: Brain Resource Server Verifying Uniform Authorization

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|---|---|---|---|---|
| 3.1 | Minimize the likelihood of a token replay attack succeeding against the Brain | 95% | 5% | 18.0 | Extremely Underserved |
| 3.2 | Minimize the likelihood of a valid request being falsely rejected due to verification failure | 80% | 70% | 9.0 | Overserved |
| 3.3 | Eliminate dual verification paths (scope vs RAR) at the resource server | 92% | 0% | 18.4 | Extremely Underserved |
| 3.4 | Minimize the likelihood of the resource server accepting a token scoped for a different operation | 90% | 20% | 16.0 | Extremely Underserved |
| 3.5 | Minimize the operational complexity of nonce/replay tracking at the resource server | 68% | 30% | 9.4 | Overserved |
| 3.6 | Maximize the likelihood that verification failures produce actionable diagnostics | 75% | 25% | 12.5 | Underserved |

## Job 4: Human Operator Exchanging Session for Brain Token (The Bridge)

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|---|---|---|---|---|
| 4.1 | Prevent session cookies from granting direct Brain access (session hijacking mitigation) | 96% | 0% | 19.2 | Extremely Underserved |
| 4.2 | Ensure the Bridge token exchange is invisible to the end user (no perceptible latency or UX change) | 85% | 0% | 17.0 | Extremely Underserved |
| 4.3 | Achieve human parity: human Brain operations use the same authorization format as agent operations | 90% | 0% | 18.0 | Extremely Underserved |
| 4.4 | Minimize developer effort to integrate the Bridge into existing dashboard code | 72% | 0% | 14.4 | Underserved |
| 4.5 | Ensure Better Auth session expiry is handled gracefully during Bridge token exchange | 78% | 40% | 10.8 | Appropriately Served |

## Top Opportunities (Score >= 12)

Ranked by opportunity score descending:

| Rank | # | Outcome Statement | Score | Job |
|---|---|---|---|---|
| 1 | 1.4 | Eliminate classification boundaries as a vulnerability surface | 19.6 | Job 1 |
| 2 | 4.1 | Prevent session cookies from granting direct Brain access | 19.2 | Job 4 |
| 3 | 2.2 | Ensure Authorizer Agent evaluates Rich Intent Objects uniformly | 18.8 | Job 2 |
| 4 | 1.7 | Ensure uniform authorization language across all actors | 18.7 | Job 1 |
| 5 | 3.3 | Eliminate dual verification paths at resource server | 18.4 | Job 3 |
| 6 | 3.1 | Minimize the likelihood of a token replay attack succeeding | 18.0 | Job 3 |
| 7 | 4.3 | Achieve human parity for Brain operations | 18.0 | Job 4 |
| 8 | 1.1 | Minimize over-privileged actor tokens | 17.5 | Job 1 |
| 9 | 1.2 | Minimize leaked token usability | 17.5 | Job 1 |
| 10 | 4.2 | Ensure Bridge token exchange is invisible to end user | 17.0 | Job 4 |
| 11 | 2.1 | Minimize approving actions without understanding | 16.5 | Job 2 |
| 12 | 3.4 | Minimize accepting token scoped for different operation | 16.0 | Job 3 |
| 13 | 2.3 | Maximize constraining capability (not just allow/deny) | 15.1 | Job 2 |
| 14 | 2.6 | Maximize traceability of authorization decisions | 14.8 | Job 2 |
| 15 | 4.4 | Minimize Bridge integration effort for dashboard | 14.4 | Job 4 |
| 16 | 1.6 | Maximize auditability of token scope | 13.5 | Job 1 |
| 17 | 2.5 | Minimize missed veto window risk | 13.5 | Job 2 |
| 18 | 3.6 | Maximize actionable diagnostics on verification failure | 12.5 | Job 3 |

## Overserved Areas (Score < 10)

| # | Outcome Statement | Score | Note |
|---|---|---|---|
| 1.3 | Minimize token acquisition time | 8.0 | Token batching and caching mitigate latency concerns |
| 1.5 | Minimize developer implementation steps | 8.0 | Client libraries maintain simplicity |
| 3.2 | Minimize false rejections | 9.0 | Clock skew handling is a known solved problem |
| 3.5 | Minimize nonce tracking complexity | 9.4 | Time-windowed sets are well-understood |
| 4.5 | Graceful session expiry during Bridge exchange | 10.8 | Standard session renewal patterns apply |

## Strategic Interpretation

The top opportunities (score >= 17) cluster into two dominant themes that reflect the Sovereign Hybrid Model:

1. **Uniform authorization model** (1.4, 2.2, 1.7, 3.3) -- highest cluster. Eliminating classification boundaries, ensuring one language of authority (Rich Intent Objects), and removing dual verification paths. This is the defining insight: **classification itself is a vulnerability**, and the solution is uniformity.

2. **Session-to-token separation (The Bridge)** (4.1, 4.3, 4.2) -- new theme. Preventing session cookies from granting Brain access and achieving human-agent parity. This addresses the architectural gap where Better Auth sessions currently bypass all structured authorization.

3. **Token replay and leakage prevention** (3.1, 1.1, 1.2) -- DPoP is the direct solution, now applied uniformly to ALL operations.

4. **Meaningful human oversight** (2.1, 2.3, 2.6) -- RAR-enriched consent transforms oversight from ceremonial to informed.

### Key Shift from Previous Scoring

The previous model scored "Backward compatibility with scopes" and "Minimize unnecessary consent prompts for low-risk routine actions" as meaningful outcomes. These have been removed or rescored because:

- **Scope-based authorization is replaced wholesale**: there is no scope path to the Brain. When the Custom AS is deployed, Bearer+scope tokens are immediately invalid -- no coexistence period, no fallback. Better Auth scopes are for UI authentication only. The Brain speaks RAR exclusively.
- **Consent prompt minimization is reframed**: the risk router still determines which actions need human review, but the authorization mechanism is uniform (RAR). Low-risk reads auto-approve through the Authorizer Agent without scope fallback.

## Data Quality Notes

- Source: Team estimates based on codebase analysis of existing `mcp/auth.ts`, `intent/authorizer.ts`, `iam/authority.ts`, and OAuth schema
- Sample size: Architectural review (N=1 team)
- Confidence: Medium -- directional, not statistically validated. Re-score after first deployment with operational data.
- **Job 4 satisfaction scores are all 0%** because the Bridge does not exist in any form today -- Better Auth sessions currently access the Brain directly.
