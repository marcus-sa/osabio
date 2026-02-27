import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { transitionOnboardingState, type WorkspaceRow } from "../../app/src/server/onboarding/onboarding-state";

function buildWorkspace(overrides?: Partial<WorkspaceRow>): WorkspaceRow {
  return {
    id: new RecordId("workspace", "w1"),
    name: "Workspace",
    status: "active",
    onboarding_complete: false,
    onboarding_turn_count: 4,
    onboarding_summary_pending: true,
    ...overrides,
  };
}

describe("onboarding state transitions", () => {
  it("finalizes only when onboardingAction is finalize_onboarding", async () => {
    const merges: Array<Record<string, unknown>> = [];
    const surrealMock = {
      update: () => ({
        merge: async (payload: Record<string, unknown>) => {
          merges.push(payload);
        },
      }),
    };

    const state = await transitionOnboardingState({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w1"),
      workspace: buildWorkspace(),
      onboardingAction: "finalize_onboarding",
      now: new Date(),
    });

    expect(state).toBe("complete");
    expect(merges.length).toBe(1);
    expect(merges[0]?.onboarding_complete).toBe(true);
  });

  it("stays summary_pending without explicit finalize action", async () => {
    const surrealMock = {
      update: () => ({
        merge: async () => undefined,
      }),
    };

    const state = await transitionOnboardingState({
      surreal: surrealMock as any,
      workspaceRecord: new RecordId("workspace", "w1"),
      workspace: buildWorkspace(),
      onboardingAction: "continue_onboarding",
      now: new Date(),
    });

    expect(state).toBe("summary_pending");
  });
});
