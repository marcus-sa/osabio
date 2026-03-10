/**
 * Consent Renderer -- pure functions for human-readable authorization display.
 *
 * Transforms brain_action authorization_details into display labels,
 * formats provider-specific values, and validates tighter-bounds constraints.
 *
 * Pure domain logic -- no IO imports.
 */
import type { BrainAction } from "./types";

// ---------------------------------------------------------------------------
// Display types
// ---------------------------------------------------------------------------

export type ConsentDisplay = {
  action_display: string;
  resource_display: string;
  constraints_display?: Record<string, string>;
};

export type BoundsValidationResult =
  | { valid: true }
  | { valid: false; violations: string[] };

// ---------------------------------------------------------------------------
// Action verb rendering
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  create: "Create",
  update: "Update",
  delete: "Delete",
  execute: "Execute",
  admin: "Administer",
};

export function renderActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? capitalize(action);
}

// ---------------------------------------------------------------------------
// Resource type rendering
// ---------------------------------------------------------------------------

const RESOURCE_LABELS: Record<string, string> = {
  workspace: "Workspace",
  task: "Task",
  decision: "Decision",
  invoice: "Invoice",
  feature: "Feature",
  project: "Project",
  observation: "Observation",
};

export function renderResourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? capitalize(resource);
}

// ---------------------------------------------------------------------------
// Constraint value formatting
// ---------------------------------------------------------------------------

const AMOUNT_FIELDS = new Set(["amount", "max_amount", "min_amount", "budget"]);

export function renderConstraintValue(key: string, value: unknown): string {
  if (AMOUNT_FIELDS.has(key) && typeof value === "number") {
    return formatCentsToDollars(value);
  }
  return String(value);
}

function formatCentsToDollars(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Full consent display rendering
// ---------------------------------------------------------------------------

export function renderConsentDisplay(action: BrainAction): ConsentDisplay {
  const display: ConsentDisplay = {
    action_display: renderActionLabel(action.action),
    resource_display: renderResourceLabel(action.resource),
  };

  if (action.constraints && Object.keys(action.constraints).length > 0) {
    display.constraints_display = Object.fromEntries(
      Object.entries(action.constraints).map(([key, value]) => [
        key,
        renderConstraintValue(key, value),
      ]),
    );
  }

  return display;
}

// ---------------------------------------------------------------------------
// Tighter-bounds constraint validation
// ---------------------------------------------------------------------------

export function validateTighterBounds(
  original: BrainAction,
  proposed: BrainAction,
): BoundsValidationResult {
  const violations: string[] = [];

  // Action and resource must match exactly
  if (original.action !== proposed.action) {
    violations.push(
      `Action mismatch: cannot change '${original.action}' to '${proposed.action}'`,
    );
  }
  if (original.resource !== proposed.resource) {
    violations.push(
      `Resource mismatch: cannot change '${original.resource}' to '${proposed.resource}'`,
    );
  }

  if (violations.length > 0) {
    return { valid: false, violations };
  }

  // If original has constraints, proposed must not drop them
  if (original.constraints) {
    if (!proposed.constraints) {
      violations.push("Cannot remove existing constraints (scope widening)");
      return { valid: false, violations };
    }

    // Each original constraint must be present and <= in proposed
    for (const [key, originalValue] of Object.entries(original.constraints)) {
      const proposedValue = proposed.constraints[key];

      if (proposedValue === undefined) {
        violations.push(`Missing constraint '${key}' from proposed (scope widening)`);
        continue;
      }

      if (typeof originalValue === "number" && typeof proposedValue === "number") {
        if (proposedValue > originalValue) {
          violations.push(
            `${key}: ${proposedValue} exceeds original bound of ${originalValue}`,
          );
        }
      } else if (typeof originalValue === "string" && typeof proposedValue === "string") {
        // String constraints must match exactly (no ordering)
        if (proposedValue !== originalValue) {
          violations.push(
            `${key}: '${proposedValue}' differs from original '${originalValue}'`,
          );
        }
      }
    }
  }

  // Adding new constraints to proposed (not in original) is tightening -- allowed

  return violations.length > 0
    ? { valid: false, violations }
    : { valid: true };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
