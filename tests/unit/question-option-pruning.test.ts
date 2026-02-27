import { describe, expect, it } from "bun:test";
import { dedupeExtractedEntities } from "../../app/src/server/extraction/filtering";
import type { ExtractionPromptEntity } from "../../app/src/server/extraction/schema";

describe("question option pruning", () => {
  it("keeps one question and drops option entities embedded in that question", () => {
    const source = "Should we ship OAuth before SSO, or do both together?";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "q1",
        kind: "question",
        text: "Should we ship OAuth before SSO, or do both together?",
        confidence: 0.95,
        evidence: "Should we ship OAuth before SSO, or do both together?",
      },
      {
        tempId: "f1",
        kind: "feature",
        text: "OAuth",
        confidence: 0.9,
        evidence: "Should we ship OAuth before SSO",
      },
      {
        tempId: "f2",
        kind: "feature",
        text: "SSO",
        confidence: 0.9,
        evidence: "Should we ship OAuth before SSO",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(1);
    expect(output[0]?.kind).toBe("question");
  });

  it("keeps decision entities when they are outside the question clause", () => {
    const source = "We decided to keep person linking field-based for phase one, but should we add graph edges in phase two?";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "d1",
        kind: "decision",
        text: "keep person linking field-based for phase one",
        confidence: 0.95,
        evidence: "We decided to keep person linking field-based for phase one",
      },
      {
        tempId: "q1",
        kind: "question",
        text: "should we add graph edges in phase two?",
        confidence: 0.9,
        evidence: "should we add graph edges in phase two?",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(2);
    expect(output.some((entity) => entity.kind === "decision")).toBe(true);
    expect(output.some((entity) => entity.kind === "question")).toBe(true);
  });

  it("does not prune entities for non-question messages", () => {
    const source = "We need OAuth and SSO support this quarter.";
    const entities: ExtractionPromptEntity[] = [
      {
        tempId: "f1",
        kind: "feature",
        text: "OAuth",
        confidence: 0.9,
        evidence: "We need OAuth and SSO support this quarter.",
      },
      {
        tempId: "f2",
        kind: "feature",
        text: "SSO",
        confidence: 0.9,
        evidence: "We need OAuth and SSO support this quarter.",
      },
    ];

    const output = dedupeExtractedEntities(entities, source, 0.6);
    expect(output).toHaveLength(2);
  });
});
