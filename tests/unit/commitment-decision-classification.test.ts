import { describe, expect, it } from "bun:test";
import { dedupeExtractedEntities } from "../../app/src/server/extraction/filtering";
import type { ExtractionPromptEntity } from "../../app/src/server/extraction/schema";

describe("commitment language decision classification", () => {
  it("normalizes feature extractions to decisions when commitment language is present", () => {
    const source = "Let's move forward with schema validation first.";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "f1",
        kind: "feature",
        text: "schema validation",
        confidence: 0.95,
        evidence: "Let's move forward with schema validation first.",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(1);
    expect(output[0]?.kind).toBe("decision");
  });

  it("keeps capability statements as features", () => {
    const source = "The platform supports schema validation.";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "f1",
        kind: "feature",
        text: "schema validation",
        confidence: 0.95,
        evidence: "The platform supports schema validation.",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(1);
    expect(output[0]?.kind).toBe("feature");
  });

  it("keeps task entities for implementation directives", () => {
    const source = "Implement schema validation this week.";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "t1",
        kind: "task",
        text: "implement schema validation this week",
        confidence: 0.95,
        evidence: "Implement schema validation this week.",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(1);
    expect(output[0]?.kind).toBe("task");
  });
});
