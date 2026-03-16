# US-02: Persist LLM Reasoning on Intent Authorization

## Problem
Carla Navarro is a workspace admin reviewing a sequence of authorized agent intents for compliance. When intent "Deploy billing service" was authorized with risk_score 65, the `evaluation.reason` field shows a one-line summary: "Approved with human veto window." She cannot see the full chain-of-thought that led the Authorizer to that risk assessment, making compliance review shallow and unverifiable.

## Who
- Workspace admin | Auditing intent authorization decisions | Needs full LLM reasoning for authorization evaluations separate from human rationale
- Compliance reviewer | Reviewing autonomous agent actions | Needs traceable justification chain from intent to execution

## Solution
Add a distinct `llm_reasoning` field to the intent table that stores the Authorizer's LLM chain-of-thought during evaluation. This is separate from the existing `reasoning` field (human-provided rationale for why the intent was created).

## Job Traces
- J3: Audit/Compliance (primary)
- J1: Forensic Debugging (secondary -- when intent authorization is the failure point)

## Domain Examples

### 1: Authorization Evaluation Reasoning -- Deploy with budget impact

Carla reviews intent "intent:deploy001" submitted by the coding agent to deploy the billing service. The existing fields show:
- `reasoning` (human): "Deploying billing service v2.3 with rate limiting fixes"
- `evaluation.reason` (summary): "Approved with human veto window"
- `evaluation.risk_score`: 65

After this feature, she also sees `llm_reasoning`:

> Intent requests deployment of billing service v2.3. Checking against active policies: Policy "production-deploy" (v3) requires human approval for services handling financial transactions. The billing service processes payments -- this policy matches. Policy "risk-threshold" sets auto-approve below risk_score 50. This intent's computed risk is 65 (above threshold) due to: (1) billing service handles revenue-critical flow, (2) deployment includes API changes. Recommending APPROVE with mandatory human veto window of 30 minutes.

### 2: Policy-Only Evaluation -- No LLM reasoning needed

Intent "intent:config001" to update a non-sensitive configuration value. The Authorizer evaluates purely against policy rules without invoking LLM reasoning (evaluation.policy_only = true). The `llm_reasoning` field is absent because no LLM was involved.

### 3: Failed Authorization -- LLM reasoning explains rejection

Intent "intent:delete001" to delete production database records. The Authorizer's LLM reasoning:

> Intent requests deletion of production database records in the billing schema. Policy "data-protection" (v2) explicitly denies destructive operations on financial data tables without dual-approval. The requester (coding agent) does not have dual-approval capability. Additionally, no backup verification step is included in the action_spec. Risk score: 95. Recommending REJECT.

Carla sees this reasoning and confirms the rejection was justified.

## UAT Scenarios (BDD)

### Scenario: LLM authorization reasoning stored on intent
Given intent "intent:deploy001" submitted by coding agent for "Deploy billing service v2.3"
And the Authorizer evaluates the intent using LLM reasoning
When the evaluation result is persisted on the intent
Then the intent has an "llm_reasoning" field with the full authorization chain-of-thought
And the existing "reasoning" field retains the human-provided rationale "Deploying billing service v2.3 with rate limiting fixes"
And the "evaluation.reason" field retains the one-line summary "Approved with human veto window"

### Scenario: Policy-only evaluation has no LLM reasoning
Given intent "intent:config001" for "Update feature flag timeout"
And the Authorizer evaluates purely against policy rules (policy_only = true)
When the evaluation result is persisted
Then the intent has no "llm_reasoning" field (or llm_reasoning is NONE)
And the "evaluation.reason" field contains the policy-based summary

### Scenario: Rejected intent has LLM reasoning explaining denial
Given intent "intent:delete001" for "Delete production billing records"
And the Authorizer's LLM evaluation produces a REJECT decision with reasoning
When the evaluation result is persisted
Then the intent "llm_reasoning" explains why the action was denied
And the "evaluation.decision" is "REJECT"
And the reasoning references specific policies by name and version

### Scenario: Admin views authorization reasoning distinct from human rationale
Given Carla Navarro views intent detail for "intent:deploy001"
And the intent has both "reasoning" (human) and "llm_reasoning" (LLM) populated
When Carla reads the intent detail
Then the human rationale is displayed as "Requester's Reasoning"
And the LLM authorization reasoning is available via "View Logic" toggle
And the two are clearly labeled and visually distinct

## Acceptance Criteria
- [ ] New `llm_reasoning` field (TYPE `option<string>`) added to `intent` table schema
- [ ] Intent authorization evaluation pipeline persists LLM chain-of-thought to `llm_reasoning`
- [ ] Existing `reasoning` field (human rationale) is unchanged and remains required
- [ ] `llm_reasoning` is absent when evaluation is policy-only (`evaluation.policy_only = true`)
- [ ] `evaluation.reason` (one-line summary) continues to be populated regardless of llm_reasoning

## Technical Notes
- Schema migration: Add `DEFINE FIELD llm_reasoning ON intent TYPE option<string>;`
- The authorization evaluation pipeline is in `oauth/intent-submission.ts` -- the LLM reasoning from the Authorizer agent needs to be captured and passed through to the intent update
- Naming: `llm_reasoning` (not `authorization_reasoning` or `evaluation_reasoning`) to be consistent with the observation field naming pattern and clearly indicate this is LLM-generated content
- Per project convention: `option<string>` since policy-only evaluations will not have it

## Dependencies
- US-01 should be implemented first to establish the pattern for reasoning field naming and storage
