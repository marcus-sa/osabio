import type {
  RulePredicate,
  RuleCondition,
  PolicyGateWarning,
} from "./types";

// ---------------------------------------------------------------------------
// Dot-Path Resolution
// ---------------------------------------------------------------------------

export const resolveDotPath = (
  context: Record<string, unknown>,
  path: string,
): unknown | undefined => {
  const segments = path.split(".");
  let current: unknown = context;

  for (const segment of segments) {
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

// ---------------------------------------------------------------------------
// Predicate Evaluation (single predicate -> boolean)
// ---------------------------------------------------------------------------

const applyOperator = (
  resolved: unknown,
  operator: RulePredicate["operator"],
  value: RulePredicate["value"],
): boolean => {
  switch (operator) {
    case "eq":
      return resolved === value;
    case "neq":
      return resolved !== value;
    case "lt":
      return typeof resolved === "number" && typeof value === "number" && resolved < value;
    case "lte":
      return typeof resolved === "number" && typeof value === "number" && resolved <= value;
    case "gt":
      return typeof resolved === "number" && typeof value === "number" && resolved > value;
    case "gte":
      return typeof resolved === "number" && typeof value === "number" && resolved >= value;
    case "in":
      return Array.isArray(value) && value.includes(resolved as string);
    case "not_in":
      return Array.isArray(value) && !value.includes(resolved as string);
    case "exists":
      return resolved !== undefined;
  }
};

export const evaluatePredicate = (
  context: Record<string, unknown>,
  predicate: RulePredicate,
): boolean => {
  const resolved = resolveDotPath(context, predicate.field);

  if (resolved === undefined && predicate.operator !== "exists") {
    return false;
  }

  return applyOperator(resolved, predicate.operator, predicate.value);
};

// ---------------------------------------------------------------------------
// Condition Evaluation (single or AND-array -> matched + warnings)
// ---------------------------------------------------------------------------

const isPredicateArray = (condition: RuleCondition): condition is RulePredicate[] =>
  Array.isArray(condition);

const fieldIsMissing = (
  context: Record<string, unknown>,
  field: string,
): boolean => resolveDotPath(context, field) === undefined;

const collectWarning = (
  context: Record<string, unknown>,
  predicate: RulePredicate,
  ruleId: string,
  policyId: string,
): PolicyGateWarning | undefined =>
  fieldIsMissing(context, predicate.field)
    ? { rule_id: ruleId, field: predicate.field, policy_id: policyId }
    : undefined;

export const evaluateCondition = (
  context: Record<string, unknown>,
  condition: RuleCondition,
  ruleId: string,
  policyId: string,
): { matched: boolean; warnings: PolicyGateWarning[] } => {
  const predicates = isPredicateArray(condition) ? condition : [condition];

  const warnings = predicates
    .map((predicate) => collectWarning(context, predicate, ruleId, policyId))
    .filter((warning): warning is PolicyGateWarning => warning !== undefined);

  const matched = predicates.every((predicate) =>
    evaluatePredicate(context, predicate),
  );

  return { matched, warnings };
};
