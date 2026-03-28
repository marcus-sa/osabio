/**
 * Unit Tests: Evidence Refs Input Validation (MCP handler boundary)
 *
 * Tests validateEvidenceRefs -- the pure validation function that rejects
 * unsupported entity types at the MCP handler boundary (defense in depth).
 */
import { describe, it, expect } from "bun:test";
import { validateEvidenceRefs } from "../../../app/src/server/mcp/create-intent-handler";

describe("validateEvidenceRefs", () => {
  it("rejects evidence_refs containing unsupported entity types", () => {
    const result = validateEvidenceRefs(["conversation:abc123"]);
    expect(result).toEqual({
      error: "Unsupported evidence entity type: 'conversation'. Allowed types: decision, feature, git_commit, learning, objective, observation, policy, project, task",
    });
  });

  it("accepts evidence_refs with all supported entity types", () => {
    const result = validateEvidenceRefs([
      "decision:d1",
      "task:t1",
      "feature:f1",
      "project:p1",
      "observation:o1",
      "policy:pol1",
      "objective:obj1",
      "learning:l1",
      "git_commit:gc1",
    ]);
    expect("error" in result).toBe(false);
    expect("refs" in result).toBe(true);
  });

  it("returns parsed RecordIds for valid refs", () => {
    const result = validateEvidenceRefs(["decision:d1", "task:t1"]);
    if ("refs" in result) {
      expect(result.refs).toHaveLength(2);
      expect(result.refs[0].table.name).toBe("decision");
      expect(result.refs[1].table.name).toBe("task");
    } else {
      throw new Error("Expected valid result");
    }
  });

  it("returns empty refs array for undefined input", () => {
    const result = validateEvidenceRefs(undefined);
    if ("refs" in result) {
      expect(result.refs).toHaveLength(0);
    } else {
      throw new Error("Expected valid result");
    }
  });
});
