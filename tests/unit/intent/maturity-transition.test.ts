/**
 * Unit tests for workspace maturity threshold transition logic.
 *
 * Pure function: given workspace maturity counts and threshold config,
 * determines whether the workspace should transition from soft to hard enforcement.
 */
import { describe, expect, it } from "bun:test";
import { shouldTransitionToHardEnforcement } from "../../../app/src/server/intent/maturity-transition";

describe("shouldTransitionToHardEnforcement", () => {
  it("returns true when both counts meet the threshold", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 5,
      completedTaskCount: 10,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(true);
  });

  it("returns true when counts exceed the threshold", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 8,
      completedTaskCount: 15,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(true);
  });

  it("returns false when decision count is below threshold", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 4,
      completedTaskCount: 10,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(false);
  });

  it("returns false when task count is below threshold", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 5,
      completedTaskCount: 9,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(false);
  });

  it("returns false when current mode is not soft", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "hard",
      confirmedDecisionCount: 10,
      completedTaskCount: 20,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(false);
  });

  it("returns false when current mode is bootstrap", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "bootstrap",
      confirmedDecisionCount: 10,
      completedTaskCount: 20,
      threshold: { min_decisions: 5, min_tasks: 10 },
    });
    expect(result).toBe(false);
  });

  it("returns false when threshold is undefined", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 10,
      completedTaskCount: 20,
      threshold: undefined,
    });
    expect(result).toBe(false);
  });

  it("handles threshold with zero minimums as always met for soft mode", () => {
    const result = shouldTransitionToHardEnforcement({
      currentMode: "soft",
      confirmedDecisionCount: 0,
      completedTaskCount: 0,
      threshold: { min_decisions: 0, min_tasks: 0 },
    });
    expect(result).toBe(true);
  });
});
