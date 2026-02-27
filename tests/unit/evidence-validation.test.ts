import { describe, expect, it } from "bun:test";
import { hasGroundedEvidence, postValidateEntities } from "../../app/src/server/extraction/validation";
import type { ExtractionPromptEntity } from "../../app/src/server/extraction/schema";

describe("evidence validation", () => {
  const message = "I've decided to use TypeScript over Rust for the backend service.";

  it("accepts entities with evidence present in the user message", () => {
    expect(hasGroundedEvidence("use TypeScript over Rust for the backend service", message)).toBe(true);
  });

  it("rejects entities with evidence not present in the user message", () => {
    expect(hasGroundedEvidence("migrate to Go for lower memory footprint", message)).toBe(false);
  });

  it("requires a literal evidence substring", () => {
    expect(hasGroundedEvidence("use   TypeScript over Rust, for the backend service", message)).toBe(false);
  });

  it("rejects empty evidence", () => {
    expect(hasGroundedEvidence("", message)).toBe(false);
  });

  it("drops entities with non-grounded evidence during post validation", () => {
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "d1",
        kind: "decision",
        text: "Use TypeScript",
        confidence: 0.9,
        evidence: "nonexistent snippet",
      },
    ];

    const output = postValidateEntities({
      entities,
      sourceText: message,
      storeThreshold: 0.6,
    });
    expect(output).toHaveLength(0);
  });
});
