import { describe, expect, it } from "bun:test";
import { buildExtractionComponentBlock } from "../../app/src/server/extraction/components";
import type { ExtractedEntity, ExtractedRelationship } from "../../app/src/shared/contracts";

function parseComponentBlock(block: string): { type: string; props: Record<string, unknown> } {
  const raw = block.replace("```component\n", "").replace("\n```", "");
  return JSON.parse(raw) as { type: string; props: Record<string, unknown> };
}

describe("component block generation", () => {
  it("generates an EntityCard JSON block for one displayable extraction", () => {
    const entities: ExtractedEntity[] = [
      { id: "d1", kind: "decision", text: "Use TypeScript", confidence: 0.9, sourceKind: "message", sourceId: "m1" },
    ];

    const block = buildExtractionComponentBlock(entities, [], 0.85);
    expect(block).toBeDefined();

    const spec = parseComponentBlock(block as string);
    expect(spec.type).toBe("EntityCard");
    expect(spec.props.name).toBe("Use TypeScript");
  });

  it("generates an ExtractionSummary block for batch extraction", () => {
    const entities: ExtractedEntity[] = [
      { id: "d1", kind: "decision", text: "Use TypeScript", confidence: 0.92, sourceKind: "message", sourceId: "m1" },
      { id: "t1", kind: "task", text: "Set up schema", confidence: 0.9, sourceKind: "message", sourceId: "m1" },
    ];
    const relationships: ExtractedRelationship[] = [
      { id: "r1", kind: "DEPENDS_ON", fromId: "t1", toId: "d1", confidence: 0.9 },
    ];

    const block = buildExtractionComponentBlock(entities, relationships, 0.85);
    expect(block).toBeDefined();

    const spec = parseComponentBlock(block as string);
    expect(spec.type).toBe("ExtractionSummary");
    expect((spec.props.entities as unknown[]).length).toBe(2);
    expect(spec.props.relationshipCount).toBe(1);
  });

  it("includes only entities above display threshold", () => {
    const entities: ExtractedEntity[] = [
      { id: "d1", kind: "decision", text: "High", confidence: 0.85, sourceKind: "message", sourceId: "m1" },
      { id: "d2", kind: "decision", text: "Low", confidence: 0.84, sourceKind: "message", sourceId: "m1" },
    ];

    const block = buildExtractionComponentBlock(entities, [], 0.85);
    const spec = parseComponentBlock(block as string);
    expect(spec.type).toBe("EntityCard");
    expect(spec.props.name).toBe("High");
  });

  it("returns undefined when there are no displayable entities", () => {
    const block = buildExtractionComponentBlock([], [], 0.85);
    expect(block).toBeUndefined();
  });
});
