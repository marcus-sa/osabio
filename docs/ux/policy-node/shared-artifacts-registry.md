# Policy Node — Shared Artifacts Registry

Every `${variable}` in the journey has a single documented source.

## Artifacts

| Artifact | Type | Source Step | Consumers | Persistence |
|----------|------|------------|-----------|-------------|
| `${policy_id}` | `RecordId<"policy">` | `create_policy` | `test_policy`, `activate_policy`, `update_policy`, `deprecate_policy`, `query_compliance` | SurrealDB `policy` table |
| `${policy_version}` | `string` | `create_policy`, `update_policy` | `evaluate_rules`, `record_trace`, `query_compliance` | `policy.version` field |
| `${intent_id}` | `RecordId<"intent">` | `submit_intent` (existing) | `evaluate_rules`, `record_trace`, `view_flagged_intent`, `approve_or_veto` | SurrealDB `intent` table |
| `${applicable_policies}` | `PolicyRecord[]` | `load_policies` | `evaluate_rules` | Transient (query result) |
| `${policy_evaluation_trace}` | `PolicyTraceEntry[]` | `evaluate_rules` | `record_trace`, `view_flagged_intent`, `query_compliance` | `intent.evaluation.policy_trace` field |
| `${policy_gate_result}` | `PolicyGateResult` | `evaluate_rules` | `evaluateIntent()` pipeline | Transient (passed to existing evaluation pipeline) |

## Type Definitions

```typescript
// Policy evaluation trace — persisted on intent.evaluation
type PolicyTraceEntry = {
  policy_id: string;        // raw ID (not RecordId — stored in JSON)
  policy_version: string;
  rule_id: string;
  effect: "allow" | "deny";
  matched: boolean;         // did the condition match this intent?
  priority: number;
};

// Full policy record from SurrealDB
type PolicyRecord = {
  id: RecordId<"policy">;
  title: string;
  description: string;
  version: string;
  status: "active" | "draft" | "deprecated" | "testing" | "superseded";
  selector: PolicySelector;
  rules: PolicyRule[];
  human_veto_required: boolean;
  max_ttl: string;          // SurrealDB duration as string
  created_by: RecordId<"identity">;
  created_at: Date;
  updated_at: Date;
};

type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

type RulePredicate = {
  field: string;                          // dot-path into intent evaluation context
  operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "exists";
  value: string | number | boolean | string[];
};

type RuleCondition = RulePredicate | RulePredicate[];  // single or AND-array

type PolicyRule = {
  id: string;
  condition: RuleCondition;   // structured JSON predicate (not string)
  effect: "allow" | "deny";
  priority: number;
};
```

## Intent Evaluation Context (available to rule conditions)

The rule evaluator receives these intent fields as the evaluation context object. Rule predicates reference fields via dot-path (e.g., `budget_limit.amount`).

```typescript
type IntentEvaluationContext = {
  goal: string;
  reasoning: string;
  priority: number;
  action_spec: {
    provider: string;
    action: string;
    params?: Record<string, unknown>;
  };
  budget_limit?: {
    amount: number;
    currency: string;
  };
  authorization_details: Array<{
    type: "osabio_action";
    action: string;
    resource: string;
  }>;
  requester_type: "human" | "agent" | "system";  // from identity.type
  requester_role?: string;                         // from identity.role
};
```

Missing fields: when a predicate references a field not present on the intent (e.g., `budget_limit.amount` when no budget is set), the predicate returns `false` (non-matching).

## Data Flow

```
create_policy → ${policy_id}, ${policy_version}
                    │
                    ▼
activate_policy → governing edges, protects edges
                    │
                    ▼
submit_intent → ${intent_id}
                    │
                    ▼
load_policies → ${applicable_policies[]}  (graph traversal)
                    │
                    ▼
evaluate_rules → ${policy_gate_result} + ${policy_evaluation_trace}
                    │
                    ├──→ record_trace (persists trace on intent)
                    │
                    ├──→ view_flagged_intent (reviewer sees trace)
                    │
                    └──→ query_compliance (auditor queries by policy version)
```
