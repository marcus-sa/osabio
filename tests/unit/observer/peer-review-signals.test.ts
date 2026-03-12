/**
 * Unit tests for compareObservationPeerReview pure function.
 *
 * Validates that the deterministic peer-review path uses linked entity count
 * (not workspace-wide totals) to decide context availability.
 */
import { describe, expect, it } from "bun:test";
import {
  compareObservationPeerReview,
  type ObservationPeerReviewSignals,
} from "../../../app/src/server/observer/verification-pipeline";

const base: ObservationPeerReviewSignals = {
  originalText: "Cache invalidation missing",
  originalSeverity: "warning",
  sourceAgent: "pm_agent",
  linkedEntityCount: 0,
};

describe("compareObservationPeerReview", () => {
  it("returns inconclusive when no linked entities exist", () => {
    const result = compareObservationPeerReview({ ...base, linkedEntityCount: 0 });
    expect(result.verdict).toBe("inconclusive");
    expect(result.verified).toBe(false);
    expect(result.text).toContain("No linked entities");
  });

  it("returns match with warning for conflict severity when linked entities exist", () => {
    const result = compareObservationPeerReview({
      ...base,
      originalSeverity: "conflict",
      linkedEntityCount: 3,
    });
    expect(result.verdict).toBe("match");
    expect(result.severity).toBe("warning");
    expect(result.verified).toBe(false);
    expect(result.text).toContain("3 linked entity");
    expect(result.text).toContain("Conflict claim requires human review");
  });

  it("returns verified match for warning severity when linked entities exist", () => {
    const result = compareObservationPeerReview({
      ...base,
      originalSeverity: "warning",
      linkedEntityCount: 2,
    });
    expect(result.verdict).toBe("match");
    expect(result.severity).toBe("info");
    expect(result.verified).toBe(true);
    expect(result.text).toContain("2 linked entity");
  });

  it("returns verified match for info severity when linked entities exist", () => {
    const result = compareObservationPeerReview({
      ...base,
      originalSeverity: "info",
      linkedEntityCount: 1,
    });
    expect(result.verdict).toBe("match");
    expect(result.severity).toBe("info");
    expect(result.verified).toBe(true);
    expect(result.text).toContain("1 linked entity");
  });
});
