import { describe, expect, it } from "bun:test";
import { dedupeExtractedEntities, hasGroundedEvidence } from "../../app/src/server/extraction/filtering";
import type { ExtractionPromptEntity } from "../../app/src/server/extraction/schema";

describe("evidence validation", () => {
  const message = "I've decided to use TypeScript over Rust for the backend service.";

  it("accepts entities with evidence present in the user message", () => {
    expect(hasGroundedEvidence("use TypeScript over Rust for the backend service", message)).toBe(true);
  });

  it("rejects entities with evidence not present in the user message", () => {
    expect(hasGroundedEvidence("migrate to Go for lower memory footprint", message)).toBe(false);
  });

  it("allows minor whitespace and punctuation differences", () => {
    expect(hasGroundedEvidence("use   TypeScript over Rust, for the backend service", message)).toBe(true);
  });

  it("rejects empty evidence", () => {
    expect(hasGroundedEvidence("", message)).toBe(false);
  });

  it("drops entities with non-grounded evidence during dedupe", () => {
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "d1",
        kind: "decision",
        text: "Use TypeScript",
        confidence: 0.9,
        evidence: "nonexistent snippet",
      },
    ];

    const output = dedupeExtractedEntities(entities, message, 0.6);
    expect(output).toHaveLength(0);
  });
});
