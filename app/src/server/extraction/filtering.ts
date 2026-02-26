import { normalizeName } from "./normalize";
import type { ExtractionPromptEntity } from "./schema";

export const placeholderEntityNames = new Set([
  "my project",
  "the project",
  "our project",
  "my app",
  "the app",
  "our app",
  "this feature",
  "the feature",
  "that feature",
  "my idea",
  "the idea",
  "this idea",
  "the thing",
  "this thing",
  "that thing",
  "my business",
  "the business",
  "my team",
  "the team",
]);

export function shouldStoreExtraction(confidence: number, threshold = 0.6): boolean {
  return confidence >= threshold;
}

export function shouldDisplayExtraction(confidence: number, threshold = 0.85): boolean {
  return confidence >= threshold;
}

export function isPlaceholderEntityName(text: string): boolean {
  return placeholderEntityNames.has(normalizeName(text));
}

export function hasGroundedEvidence(evidence: string, sourceText: string): boolean {
  const normalizedEvidence = normalizeName(evidence);
  if (normalizedEvidence.length === 0) {
    return false;
  }

  const normalizedSource = normalizeName(sourceText);
  return normalizedSource.includes(normalizedEvidence);
}

export function dedupeExtractedEntities(
  entities: ExtractionPromptEntity[],
  sourceText: string,
  storeThreshold: number,
): ExtractionPromptEntity[] {
  const byTempId = new Map<string, ExtractionPromptEntity>();

  for (const entity of entities) {
    const tempId = entity.tempId.trim();
    if (tempId.length === 0) {
      continue;
    }

    const text = entity.text.trim();
    if (text.length === 0) {
      continue;
    }

    const evidence = entity.evidence.trim();
    if (evidence.length === 0) {
      continue;
    }

    if (!shouldStoreExtraction(entity.confidence, storeThreshold)) {
      continue;
    }

    if (isPlaceholderEntityName(text)) {
      continue;
    }

    if (!hasGroundedEvidence(evidence, sourceText)) {
      continue;
    }

    const existing = byTempId.get(tempId);
    if (!existing || entity.confidence > existing.confidence) {
      byTempId.set(tempId, {
        ...entity,
        tempId,
        text,
        evidence,
      });
    }
  }

  return [...byTempId.values()];
}
