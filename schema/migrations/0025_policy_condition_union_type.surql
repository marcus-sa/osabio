-- Migration 0025: Allow AND-joined conditions (array of predicates) on policy rules
-- FR-1a: RuleCondition = RulePredicate | RulePredicate[] (AND-joined)

DEFINE FIELD OVERWRITE rules[*].condition ON policy TYPE object | array FLEXIBLE;
DEFINE FIELD rules[*].condition[*].field ON policy TYPE string;
DEFINE FIELD rules[*].condition[*].operator ON policy TYPE string;
DEFINE FIELD rules[*].condition[*].value ON policy TYPE string | number | bool | array | object FLEXIBLE;
