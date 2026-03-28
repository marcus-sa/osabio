# Walking Skeleton: Evidence-Backed Intent Authorization

## Definition

The thinnest E2E vertical slice that proves a user can accomplish the core goal: **an agent submits evidence with an intent, the system verifies it, and evidence quality influences the authorization decision**.

## Three Walking Skeletons

### Skeleton 1: Evidence submitted, verified, evaluation proceeds (US-01 + US-02 + US-04)

**User goal**: Agent provides evidence references when requesting authorization, and the system verifies them before making a decision.

**Journey**:
1. Ravi has confirmed decisions and completed tasks in the workspace (evidence pool exists)
2. Logistics-Planner creates an intent with `evidence_refs` pointing to the decision and task
3. Agent submits the intent for authorization
4. Verification pipeline checks that references exist in the workspace
5. Evaluation proceeds with evidence context available
6. Verification result is stored on the intent record

**Observable outcome**: The intent record contains 2 evidence references, the verification result shows `verified_count: 2`, and evaluation completes.

**Stakeholder demo**: "Look -- the agent cited a specific decision and task as evidence. The system verified both exist in this workspace before evaluating. The verification result is on the intent record for audit."

### Skeleton 2: Missing evidence elevates risk under soft enforcement (US-01 + US-03)

**User goal**: Intents without evidence are penalized in risk scoring, routing them to human review.

**Journey**:
1. Workspace is in "soft" enforcement mode
2. Logistics-Planner creates an intent without evidence references
3. Agent submits the intent for authorization
4. Soft enforcement adds risk penalty for missing evidence
5. Elevated risk score routes the intent to a veto window instead of auto-approval

**Observable outcome**: The effective risk score is higher than the base score, and the intent is routed to veto window.

**Stakeholder demo**: "The agent didn't provide any evidence for this action. Instead of blocking it, the system raised the risk score, which means Ravi now has to review it. Incentive to provide evidence next time."

### Skeleton 3: Hard enforcement blocks insufficient evidence (US-06)

**User goal**: When a workspace requires evidence, intents without it are rejected before the risk assessor runs.

**Journey**:
1. Workspace is in "hard" enforcement mode
2. Logistics-Planner creates an intent without evidence references
3. Agent submits the intent for authorization
4. Hard enforcement gate rejects the intent before LLM evaluation
5. Rejection reason explains the evidence shortfall

**Observable outcome**: Intent status is "failed", error_reason contains "evidence", no evaluation result exists.

**Stakeholder demo**: "The workspace requires evidence for all intents. This agent didn't provide any, so it was rejected instantly -- no expensive LLM call wasted. The error message tells the agent exactly what it needs."

## Implementation Sequence

Enable Skeleton 1 first (one-at-a-time TDD). Once it passes:
- Enable Skeleton 2 (soft enforcement penalty)
- Enable Skeleton 3 (hard enforcement rejection)

All three skeletons are in `walking-skeleton.test.ts`. Only Skeleton 1 starts unskipped.

## Litmus Test

| Check | Skeleton 1 | Skeleton 2 | Skeleton 3 |
|-------|-----------|-----------|-----------|
| Title describes user goal | Agent submits evidence and receives verified authorization | Missing evidence elevates risk | Hard enforcement blocks insufficient evidence |
| Given/When describe user actions | Agent creates intent with evidence refs | Agent creates intent without evidence | Agent creates intent without evidence |
| Then describes user observations | Evidence verified, evaluation proceeds | Risk elevated, routed to veto | Rejected with reason |
| Non-technical stakeholder confirms | Yes | Yes | Yes |
