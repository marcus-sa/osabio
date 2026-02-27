import type { ExtractionPromptEntity, ExtractionPromptRelationship } from "./schema";

export function shouldStoreExtraction(confidence: number, threshold = 0.6): boolean {
  return confidence >= threshold;
}

export function shouldDisplayExtraction(confidence: number, threshold = 0.85): boolean {
  return confidence >= threshold;
}

export function hasGroundedEvidence(evidence: string, sourceText: string): boolean {
  const trimmedEvidence = evidence.trim();
  if (trimmedEvidence.length === 0) {
    return false;
  }

  return sourceText.includes(trimmedEvidence);
}

export function postValidateEntities(input: {
  entities: ExtractionPromptEntity[];
  sourceText: string;
  storeThreshold: number;
}): ExtractionPromptEntity[] {
  const byTempId = new Map<string, ExtractionPromptEntity>();

  for (const entity of input.entities) {
    const tempId = entity.tempId.trim();
    if (tempId.length === 0) {
      continue;
    }

    const text = entity.text.trim();
    if (text.length < 3) {
      continue;
    }

    const evidence = entity.evidence.trim();
    if (evidence.length === 0) {
      continue;
    }

    if (!shouldStoreExtraction(entity.confidence, input.storeThreshold)) {
      continue;
    }

    if (!hasGroundedEvidence(evidence, input.sourceText)) {
      continue;
    }

    const assigneeName = ("assignee_name" in entity ? entity.assignee_name : undefined)?.trim();
    const resolvedFromMessageId = ("resolvedFromMessageId" in entity ? entity.resolvedFromMessageId : undefined)?.trim();
    const normalized: ExtractionPromptEntity = {
      ...entity,
      tempId,
      text,
      evidence,
      ...(assigneeName ? { assignee_name: assigneeName } : {}),
      ...(resolvedFromMessageId ? { resolvedFromMessageId } : {}),
    };

    const existing = byTempId.get(tempId);
    if (!existing || normalized.confidence > existing.confidence) {
      byTempId.set(tempId, normalized);
    }
  }

  return [...byTempId.values()];
}

export function postValidateRelationships(input: {
  relationships: ExtractionPromptRelationship[];
  storeThreshold: number;
}): ExtractionPromptRelationship[] {
  return input.relationships
    .filter((relationship) => shouldStoreExtraction(relationship.confidence, input.storeThreshold))
    .map((relationship) => {
      const kind = relationship.kind.trim();
      const fromTempId = relationship.fromTempId.trim();
      const toTempId = relationship.toTempId.trim();
      const fromText = relationship.fromText.trim();
      const toText = relationship.toText.trim();

      return {
        ...relationship,
        kind,
        fromTempId,
        toTempId,
        fromText,
        toText,
      };
    })
    .filter(
      (relationship) =>
        relationship.kind.length > 0 &&
        relationship.fromTempId.length > 0 &&
        relationship.toTempId.length > 0 &&
        relationship.fromText.length > 0 &&
        relationship.toText.length > 0,
    );
}
