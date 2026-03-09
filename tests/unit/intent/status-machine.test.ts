import { describe, expect, test } from "bun:test";
import { transitionStatus } from "../../../app/src/server/intent/status-machine";
import type { IntentStatus } from "../../../app/src/server/intent/types";

describe("transitionStatus", () => {
  describe("valid transitions", () => {
    const validTransitions: Array<[IntentStatus, IntentStatus]> = [
      ["draft", "pending_auth"],
      ["pending_auth", "pending_veto"],
      ["pending_auth", "authorized"],
      ["pending_auth", "vetoed"],
      ["pending_auth", "failed"],
      ["pending_veto", "authorized"],
      ["pending_veto", "vetoed"],
      ["authorized", "executing"],
      ["executing", "completed"],
      ["executing", "failed"],
    ];

    test.each(validTransitions)(
      "allows transition from %s to %s",
      (from, to) => {
        const result = transitionStatus(from, to);
        expect(result).toEqual({ ok: true, status: to });
      },
    );
  });

  describe("invalid transitions", () => {
    const invalidTransitions: Array<[IntentStatus, IntentStatus]> = [
      ["draft", "executing"],
      ["draft", "completed"],
      ["draft", "vetoed"],
      ["completed", "draft"],
      ["vetoed", "authorized"],
      ["failed", "executing"],
      ["executing", "draft"],
      ["pending_veto", "pending_auth"],
      ["authorized", "pending_auth"],
    ];

    test.each(invalidTransitions)(
      "rejects transition from %s to %s",
      (from, to) => {
        const result = transitionStatus(from, to);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain(from);
          expect(result.error).toContain(to);
        }
      },
    );
  });

  describe("terminal states have no outgoing transitions", () => {
    const terminalStates: IntentStatus[] = ["completed", "vetoed", "failed"];
    const allStatuses: IntentStatus[] = [
      "draft",
      "pending_auth",
      "pending_veto",
      "authorized",
      "executing",
      "completed",
      "vetoed",
      "failed",
    ];

    for (const terminal of terminalStates) {
      for (const target of allStatuses) {
        test(`rejects transition from terminal state ${terminal} to ${target}`, () => {
          const result = transitionStatus(terminal, target);
          expect(result.ok).toBe(false);
        });
      }
    }
  });
});
