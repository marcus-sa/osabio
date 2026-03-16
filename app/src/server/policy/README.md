# Policy

Deterministic governance rules stored as graph nodes — versioned, lifecycle-managed, and evaluated by the Authorizer before minting intent tokens.

## The Problem

Governance rules change. Today you require human approval for all deployments. Next month, you trust the coding agent to deploy to staging autonomously. These rules can't live in agent prompts — they'd be invisible, unversioned, and scattered across configurations. Policies are graph-native rules that the Authorizer evaluates deterministically, with version chains so you can see what changed and when.

## What It Does

- **Policy lifecycle**: `draft` -> `testing` -> `active` -> `superseded` (or `deprecated`)
- **Version chains**: Create a new version → previous one automatically superseded in an atomic transaction
- **Typed rules**: Each policy carries typed rules with scopes, conditions, and approval requirements
- **Predicate evaluation**: Evaluates policy conditions against intent context using configurable predicates
- **Edge creation**: `governing` and `protects` edges link policies to the entities they govern
- **Policy validation**: Structural validation of rules, scopes, and conditions before activation

## Key Concepts

| Term | Definition |
|------|------------|
| **Policy** | A governance rule with name, description, typed rules, lifecycle status, and version chain |
| **Policy Lifecycle** | `draft` (editing) -> `testing` (trial) -> `active` (enforced) -> `superseded` (replaced) or `deprecated` (retired) |
| **Version Chain** | Linked list of policy versions — new version creation atomically supersedes the previous one |
| **Policy Selector** | SurrealQL filter expression that determines which intents a policy applies to |
| **Predicate Evaluator** | Evaluates policy conditions against intent context (e.g. "risk_score > 50 AND action = 'deploy'") |
| **Human Veto Flag** | Policy-level flag that forces veto_window routing regardless of risk score |

## How It Works

**Example — creating a deployment policy:**

1. `POST /api/workspaces/:id/policies` with:
   ```
   name: "Staging deployment requires review"
   rules: [{ condition: "action.type = 'deploy' AND action.target = 'staging'", effect: "require_veto" }]
   ```
2. Policy created with status: `draft`
3. Admin tests → `POST /policies/:id/activate` → status: `active`
4. Agent creates intent to deploy to staging
5. Authorizer evaluates: loads active policies → predicate evaluator matches this policy
6. Policy effect: `require_veto` → intent routed through veto window
7. Later, admin updates policy → `POST /policies/:id/versions` creates v2
8. v1 atomically superseded → v2 active → version chain maintained

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Version monotonicity** | Atomic transaction ensures only one active version per policy chain |
| **No matching policy** | Intent proceeds with default risk-based routing |
| **Multiple matching policies** | Most restrictive effect wins (reject > require_veto > allow) |
| **Activate draft with errors** | Validation blocks activation — must fix structural issues first |
| **Deprecate active policy** | Status: `deprecated`, governing edges preserved for audit trail |

## Where It Fits

```text
Admin creates/updates policy
  |
  v
Policy Graph Node
  +---> draft -> testing -> active
  +---> governing edge -> project/feature
  +---> protects edge -> workspace
  |
  v
Intent Created by Agent
  |
  v
Authorizer
  +---> Load active policies for workspace
  +---> Predicate evaluator matches conditions
  +---> Apply most restrictive effect
  |
  v
Routing Decision (auto_approve | require_veto | reject)
```

**Consumes**: Admin policy definitions, intent context for evaluation
**Produces**: Policy records, version chains, governance edges, evaluation results

## File Structure

```text
policy/
  policy-route.ts          # HTTP endpoints: CRUD, activate, deprecate, version, list
  policy-queries.ts        # SurrealDB CRUD + atomic version chain management
  policy-validation.ts     # Structural validation of rules, scopes, and conditions
  predicate-evaluator.ts   # Evaluate policy conditions against intent context
  policy-gate.ts           # Policy evaluation gate for the Authorizer
  types.ts                 # Policy, PolicyRule, PolicyStatus, VersionChain types
```
