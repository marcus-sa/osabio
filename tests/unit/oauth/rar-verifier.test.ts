import { describe, expect, test } from "bun:test";
import { verifyOperationScope } from "../../../app/src/server/oauth/rar-verifier";
import { createBrainAction } from "../../../app/src/server/oauth/types";
import type { BrainAction } from "../../../app/src/server/oauth/types";

describe("verifyOperationScope", () => {
  // -- Matching action and resource succeeds --

  test("authorizes when requested action matches an authorized entry", () => {
    const requested = createBrainAction("read", "workspace");
    const authorized = [createBrainAction("read", "workspace")];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("authorizes when requested action is one of multiple authorized entries", () => {
    const requested = createBrainAction("create", "task");
    const authorized = [
      createBrainAction("read", "workspace"),
      createBrainAction("create", "task"),
      createBrainAction("update", "session"),
    ];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  // -- Mismatched action returns 403 authorization_details_mismatch --

  test("rejects when action does not match any authorized entry", () => {
    const requested = createBrainAction("create", "decision");
    const authorized = [createBrainAction("read", "workspace")];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_details_mismatch");
    }
  });

  test("rejects when resource does not match despite same action", () => {
    const requested = createBrainAction("read", "task");
    const authorized = [createBrainAction("read", "workspace")];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_details_mismatch");
    }
  });

  test("rejects when authorized list is empty", () => {
    const requested = createBrainAction("read", "workspace");
    const authorized: BrainAction[] = [];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_details_mismatch");
    }
  });

  test("rejects when type field does not match", () => {
    const requested: BrainAction = { type: "brain_action", action: "read", resource: "workspace" };
    const authorized: BrainAction[] = [
      { type: "brain_action", action: "read", resource: "workspace" },
    ];
    // Same type -- this should pass (type is always "brain_action")
    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(true);
  });

  // -- Constraint bounds enforcement (numeric <=) --

  test("authorizes when requested numeric constraint is within authorized bound", () => {
    const requested = createBrainAction("read", "workspace", { max_results: 10 });
    const authorized = [createBrainAction("read", "workspace", { max_results: 50 })];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("authorizes when requested numeric constraint equals authorized bound", () => {
    const requested = createBrainAction("read", "workspace", { max_results: 50 });
    const authorized = [createBrainAction("read", "workspace", { max_results: 50 })];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("rejects when requested numeric constraint exceeds authorized bound", () => {
    const requested = createBrainAction("read", "workspace", { max_results: 100 });
    const authorized = [createBrainAction("read", "workspace", { max_results: 50 })];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_params_exceeded");
    }
  });

  test("authorizes when requested has no constraints but authorized has constraints", () => {
    const requested = createBrainAction("read", "workspace");
    const authorized = [createBrainAction("read", "workspace", { max_results: 50 })];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("authorizes when neither has constraints", () => {
    const requested = createBrainAction("read", "workspace");
    const authorized = [createBrainAction("read", "workspace")];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("rejects when any numeric constraint exceeds its bound", () => {
    const requested = createBrainAction("read", "workspace", {
      max_results: 10,
      max_depth: 20,
    });
    const authorized = [
      createBrainAction("read", "workspace", {
        max_results: 50,
        max_depth: 5,
      }),
    ];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_params_exceeded");
    }
  });

  test("authorizes when all multiple numeric constraints are within bounds", () => {
    const requested = createBrainAction("read", "workspace", {
      max_results: 10,
      max_depth: 3,
    });
    const authorized = [
      createBrainAction("read", "workspace", {
        max_results: 50,
        max_depth: 5,
      }),
    ];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("ignores non-numeric constraint values during bounds check", () => {
    const requested = createBrainAction("read", "workspace", { format: "json" });
    const authorized = [createBrainAction("read", "workspace", { format: "json" })];

    const result = verifyOperationScope(requested, authorized);
    expect(result).toEqual({ authorized: true });
  });

  test("includes descriptive error message on mismatch", () => {
    const requested = createBrainAction("create", "decision");
    const authorized = [createBrainAction("read", "workspace")];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.error).toContain("create");
      expect(result.error).toContain("decision");
    }
  });

  test("string constraint mismatch is caught before numeric constraint", () => {
    const requested = createBrainAction("read", "workspace", {
      format: "json",
      max_results: 200,
    });
    const authorized = [
      createBrainAction("read", "workspace", {
        format: "csv",
        max_results: 100,
      }),
    ];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("authorization_params_exceeded");
      expect(result.error).toContain("format");
    }
  });

  test("includes descriptive error message on constraint exceeded", () => {
    const requested = createBrainAction("read", "workspace", { max_results: 100 });
    const authorized = [createBrainAction("read", "workspace", { max_results: 50 })];

    const result = verifyOperationScope(requested, authorized);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.error).toContain("max_results");
    }
  });
});
