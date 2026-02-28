import type { EntityCategory, EntityKind, ExtractedEntity, ExtractedRelationship } from "../../shared/contracts";
import { normalizeName } from "./normalize";
import { shouldDisplayExtraction } from "./validation";

type ExtractableEntityKind = Exclude<EntityKind, "workspace">;

type CardEntity = {
  kind: ExtractableEntityKind;
  name: string;
  confidence: number;
  status: "captured";
  category?: EntityCategory;
};

export function buildExtractionComponentBlock(
  entities: ExtractedEntity[],
  relationships: ExtractedRelationship[],
  displayThreshold: number,
): string | undefined {
  const summaryEntities = new Map<string, CardEntity>();

  for (const entity of [...entities].sort((a, b) => b.confidence - a.confidence)) {
    if (entity.kind === "workspace" || !shouldDisplayExtraction(entity.confidence, displayThreshold)) {
      continue;
    }

    const name = entity.text.trim();
    if (name.length === 0) {
      continue;
    }

    const key = `${entity.kind}:${normalizeName(name)}`;
    if (!summaryEntities.has(key)) {
      summaryEntities.set(key, {
        kind: entity.kind as ExtractableEntityKind,
        name,
        confidence: entity.confidence,
        status: "captured",
        ...(entity.category ? { category: entity.category } : {}),
      });
    }
  }

  const cards = [...summaryEntities.values()].slice(0, 6);
  if (cards.length === 0) {
    return undefined;
  }

  const componentSpec = cards.length === 1
    ? {
        type: "EntityCard",
        props: cards[0],
      }
    : {
        type: "ExtractionSummary",
        props: {
          title: "Captured from your latest message",
          entities: cards,
          relationshipCount: relationships.filter((relationship) =>
            shouldDisplayExtraction(relationship.confidence, displayThreshold)
          ).length,
        },
      };

  return ["```component", JSON.stringify(componentSpec, null, 2), "```"].join("\n");
}
