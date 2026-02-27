import { describe, expect, it } from "bun:test";
import {
  deriveMessageTitle,
  computeTitleUpgrade,
  type TitleUpgradeInput,
} from "../../app/src/server/workspace/conversation-sidebar";

describe("conversation title derivation", () => {
  describe("deriveMessageTitle", () => {
    it("returns short text as-is", () => {
      expect(deriveMessageTitle("Planning the auth flow")).toBe("Planning the auth flow");
    });

    it("trims whitespace", () => {
      expect(deriveMessageTitle("  hello  ")).toBe("hello");
    });

    it("truncates text longer than 72 characters", () => {
      const longText = "A".repeat(100);
      const result = deriveMessageTitle(longText);
      expect(result.length).toBe(72);
      expect(result.endsWith("...")).toBe(true);
    });

    it("does not truncate text exactly 72 characters", () => {
      const exact = "B".repeat(72);
      expect(deriveMessageTitle(exact)).toBe(exact);
    });
  });

  describe("computeTitleUpgrade", () => {
    it("returns undefined when title_source is not 'message'", () => {
      const input: TitleUpgradeInput = {
        titleSource: "entity",
        entityTexts: [
          { kind: "task", text: "a" },
          { kind: "task", text: "b" },
          { kind: "task", text: "c" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBeUndefined();
    });

    it("returns undefined when title_source is undefined", () => {
      const input: TitleUpgradeInput = {
        entityTexts: [
          { kind: "task", text: "a" },
          { kind: "task", text: "b" },
          { kind: "task", text: "c" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBeUndefined();
    });

    it("returns undefined when fewer than 3 qualifying entities", () => {
      const input: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "first" },
          { kind: "decision", text: "second" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBeUndefined();
    });

    it("does not count person entities toward threshold", () => {
      const input: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "only task" },
          { kind: "person", text: "Alice" },
          { kind: "person", text: "Bob" },
          { kind: "person", text: "Carol" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBeUndefined();
    });

    it("does not count workspace entities toward threshold", () => {
      const input: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "only task" },
          { kind: "workspace", text: "ws1" },
          { kind: "workspace", text: "ws2" },
          { kind: "workspace", text: "ws3" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBeUndefined();
    });

    it("uses dominant project name when available", () => {
      const input: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "setup" },
          { kind: "decision", text: "use React" },
          { kind: "feature", text: "auth module" },
        ],
        dominantProjectName: "Brain Platform",
      };

      expect(computeTitleUpgrade(input)).toBe("Brain Platform");
    });

    it("falls back to dominant entity text without project name", () => {
      const input: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "setup database" },
          { kind: "task", text: "setup database" },
          { kind: "decision", text: "use Postgres" },
        ],
      };

      expect(computeTitleUpgrade(input)).toBe("setup database");
    });

    it("title upgrade locks: entity source prevents re-upgrade", () => {
      // Once title_source is "entity", computeTitleUpgrade returns undefined
      const firstUpgrade: TitleUpgradeInput = {
        titleSource: "message",
        entityTexts: [
          { kind: "task", text: "a" },
          { kind: "task", text: "b" },
          { kind: "feature", text: "c" },
        ],
      };

      const result = computeTitleUpgrade(firstUpgrade);
      expect(result).toBeDefined();

      // Simulating post-upgrade state
      const afterUpgrade: TitleUpgradeInput = {
        titleSource: "entity",
        entityTexts: [
          { kind: "task", text: "a" },
          { kind: "task", text: "b" },
          { kind: "feature", text: "c" },
          { kind: "decision", text: "d" },
        ],
      };

      expect(computeTitleUpgrade(afterUpgrade)).toBeUndefined();
    });
  });
});
