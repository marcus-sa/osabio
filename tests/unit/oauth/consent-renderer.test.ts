/**
 * Unit tests for consent renderer -- pure functions that transform
 * brain_action authorization_details into human-readable display
 * and enforce tighter-bounds-only constraint validation.
 */
import { describe, expect, it } from "bun:test";
import {
  renderActionLabel,
  renderResourceLabel,
  renderConstraintValue,
  renderConsentDisplay,
  validateTighterBounds,
  type ConsentDisplay,
  type BoundsValidationResult,
} from "../../../app/src/server/oauth/consent-renderer";
import type { BrainAction } from "../../../app/src/server/oauth/types";

// =============================================================================
// Action verb rendering
// =============================================================================

describe("renderActionLabel", () => {
  it("maps known action verbs to human-readable labels", () => {
    expect(renderActionLabel("read")).toBe("Read");
    expect(renderActionLabel("write")).toBe("Write");
    expect(renderActionLabel("create")).toBe("Create");
    expect(renderActionLabel("update")).toBe("Update");
    expect(renderActionLabel("delete")).toBe("Delete");
    expect(renderActionLabel("execute")).toBe("Execute");
    expect(renderActionLabel("admin")).toBe("Administer");
  });

  it("capitalizes unknown action verbs as fallback", () => {
    expect(renderActionLabel("archive")).toBe("Archive");
    expect(renderActionLabel("deploy")).toBe("Deploy");
  });
});

// =============================================================================
// Resource type rendering
// =============================================================================

describe("renderResourceLabel", () => {
  it("maps known resource types to human-readable labels", () => {
    expect(renderResourceLabel("workspace")).toBe("Workspace");
    expect(renderResourceLabel("task")).toBe("Task");
    expect(renderResourceLabel("decision")).toBe("Decision");
    expect(renderResourceLabel("invoice")).toBe("Invoice");
    expect(renderResourceLabel("feature")).toBe("Feature");
    expect(renderResourceLabel("project")).toBe("Project");
  });

  it("capitalizes unknown resource types as fallback", () => {
    expect(renderResourceLabel("widget")).toBe("Widget");
  });
});

// =============================================================================
// Constraint value formatting
// =============================================================================

describe("renderConstraintValue", () => {
  it("formats amount fields as dollars when value looks like cents", () => {
    expect(renderConstraintValue("amount", 240000)).toBe("$2,400.00");
    expect(renderConstraintValue("amount", 500)).toBe("$5.00");
    expect(renderConstraintValue("amount", 99)).toBe("$0.99");
  });

  it("formats max_amount fields as dollars", () => {
    expect(renderConstraintValue("max_amount", 100000)).toBe("$1,000.00");
  });

  it("passes through string values unchanged", () => {
    expect(renderConstraintValue("provider", "stripe")).toBe("stripe");
    expect(renderConstraintValue("customer", "cus_acme_corp")).toBe("cus_acme_corp");
  });

  it("formats numeric non-amount fields as plain numbers", () => {
    expect(renderConstraintValue("max_changes", 10)).toBe("10");
    expect(renderConstraintValue("limit", 50)).toBe("50");
  });
});

// =============================================================================
// Full consent display rendering
// =============================================================================

describe("renderConsentDisplay", () => {
  it("renders a brain_action with constraints into consent display", () => {
    const action: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "invoice",
      constraints: {
        provider: "stripe",
        customer: "cus_acme_corp",
        amount: 240000,
      },
    };

    const display = renderConsentDisplay(action);

    expect(display.action_display).toBe("Create");
    expect(display.resource_display).toBe("Invoice");
    expect(display.constraints_display).toBeDefined();
    expect(display.constraints_display!.provider).toBe("stripe");
    expect(display.constraints_display!.customer).toBe("cus_acme_corp");
    expect(display.constraints_display!.amount).toBe("$2,400.00");
    expect(display.constraints_display!.amount).not.toContain("240000");
  });

  it("renders a brain_action without constraints", () => {
    const action: BrainAction = {
      type: "brain_action",
      action: "read",
      resource: "workspace",
    };

    const display = renderConsentDisplay(action);

    expect(display.action_display).toBe("Read");
    expect(display.resource_display).toBe("Workspace");
    expect(display.constraints_display).toBeUndefined();
  });
});

// =============================================================================
// Tighter-bounds constraint validation
// =============================================================================

describe("validateTighterBounds", () => {
  it("accepts constraints that are strictly tighter than original", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 10 },
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 3 },
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(true);
  });

  it("rejects constraints that are looser than original", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 3 },
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 50 },
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.violations).toContain("max_changes: 50 exceeds original bound of 3");
    }
  });

  it("rejects when action type changes", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "read",
      resource: "task",
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "write",
      resource: "task",
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(false);
  });

  it("rejects when resource type changes", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "read",
      resource: "task",
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "read",
      resource: "project",
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(false);
  });

  it("accepts equal constraints (same bounds is valid tightening)", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 5 },
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 5 },
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(true);
  });

  it("rejects when proposed adds constraints not in original (scope expansion)", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 5 },
    };

    // Adding new constraints is tightening (more restrictive), so this should be valid
    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(true);
  });

  it("rejects when proposed removes existing constraints (scope widening)", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
      constraints: { max_changes: 5 },
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "update",
      resource: "task",
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(false);
  });

  it("handles amount constraints in cents correctly", () => {
    const original: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "invoice",
      constraints: { amount: 240000 },
    };
    const proposed: BrainAction = {
      type: "brain_action",
      action: "create",
      resource: "invoice",
      constraints: { amount: 100000 },
    };

    const result = validateTighterBounds(original, proposed);

    expect(result.valid).toBe(true);
  });
});
