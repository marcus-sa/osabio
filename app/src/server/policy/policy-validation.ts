/**
 * Pure validation functions for policy creation request bodies.
 *
 * No IO, no DB access -- only data-in, result-out.
 */

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_OPERATORS = new Set([
  "eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "exists",
]);

const VALID_EFFECTS = new Set(["allow", "deny", "evidence_requirement"]);

// ---------------------------------------------------------------------------
// Predicate validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePredicate(predicate: unknown, ruleIndex: number, predicateLabel: string): string[] {
  if (!isPlainObject(predicate)) {
    return [`rule[${ruleIndex}].${predicateLabel}: condition must be an object with field, operator, and value`];
  }

  const errors: string[] = [];

  if (typeof predicate.field !== "string" || predicate.field.trim() === "") {
    errors.push(`rule[${ruleIndex}].${predicateLabel}: predicate must have a non-empty "field" string`);
  }

  if (typeof predicate.operator !== "string" || !VALID_OPERATORS.has(predicate.operator)) {
    errors.push(
      `rule[${ruleIndex}].${predicateLabel}: predicate operator must be one of ${[...VALID_OPERATORS].join(", ")}`,
    );
  }

  if (!("value" in predicate)) {
    errors.push(`rule[${ruleIndex}].${predicateLabel}: predicate must have a "value" property`);
  }

  return errors;
}

function validateCondition(condition: unknown, ruleIndex: number): string[] {
  if (Array.isArray(condition)) {
    if (condition.length === 0) {
      return [`rule[${ruleIndex}].condition: array condition must have at least one predicate`];
    }
    return condition.flatMap((pred, i) =>
      validatePredicate(pred, ruleIndex, `condition[${i}]`),
    );
  }

  return validatePredicate(condition, ruleIndex, "condition");
}

// ---------------------------------------------------------------------------
// Rule validation
// ---------------------------------------------------------------------------

function validateRule(rule: unknown, index: number): string[] {
  if (!isPlainObject(rule)) {
    return [`rule[${index}]: must be an object`];
  }

  const errors: string[] = [];

  // ID
  if (typeof rule.id !== "string" || (rule.id as string).trim() === "") {
    errors.push(`rule[${index}]: id must be a non-empty string`);
  }

  // Priority
  if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) {
    errors.push(`rule[${index}]: priority must be a finite number`);
  }

  // Effect
  if (!VALID_EFFECTS.has(rule.effect as string)) {
    errors.push(`rule[${index}]: effect must be "allow", "deny", or "evidence_requirement"`);
  }

  // Evidence requirement fields
  if (rule.effect === "evidence_requirement") {
    if (typeof rule.min_evidence_count !== "number" || !Number.isFinite(rule.min_evidence_count) || (rule.min_evidence_count as number) < 1) {
      errors.push(`rule[${index}]: evidence_requirement rules must have min_evidence_count >= 1`);
    }
    if (rule.required_types !== undefined && !Array.isArray(rule.required_types)) {
      errors.push(`rule[${index}]: required_types must be an array of strings when provided`);
    }
  }

  // Condition
  errors.push(...validateCondition(rule.condition, index));

  return errors;
}

// ---------------------------------------------------------------------------
// Top-level body validation
// ---------------------------------------------------------------------------

type PolicyCreateInput = {
  title: unknown;
  description: unknown;
  rules: unknown;
};

export function validatePolicyCreateBody(body: PolicyCreateInput): ValidationResult {
  if (body === null || body === undefined) {
    return { valid: false, errors: ["request body is required"] };
  }

  const errors: string[] = [];

  // Title
  if (typeof body.title !== "string" || body.title.trim() === "") {
    errors.push("title is required and must be a non-empty string");
  }

  // Description
  if (typeof body.description !== "string" || body.description.trim() === "") {
    errors.push("description is required and must be a non-empty string");
  }

  // Rules
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    errors.push("at least one rule is required");
  } else {
    for (let i = 0; i < body.rules.length; i++) {
      errors.push(...validateRule(body.rules[i], i));
    }
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}
