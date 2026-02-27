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
  const hasDecisionCommitmentLanguage = hasCommitmentIndicator(sourceText);

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

    const normalizedEntity = normalizeEntityKind(entity, hasDecisionCommitmentLanguage);
    const existing = byTempId.get(tempId);
    if (!existing || normalizedEntity.confidence > existing.confidence) {
      byTempId.set(tempId, {
        ...normalizedEntity,
        tempId,
        text,
        evidence,
      });
    }
  }

  return pruneQuestionAlternatives([...byTempId.values()], sourceText);
}

const commitmentIndicators = [
  /let'?s\s+go\s+with/i,
  /let'?s\s+move\s+forward\s+with/i,
  /\bwe\s+decided\b/i,
  /\bi(?:'m| am)?\s+choosing\b/i,
  /\bgoing\s+with\b/i,
  /\bsettled\s+on\b/i,
  /\bcommitted\s+to\b/i,
];

function hasCommitmentIndicator(sourceText: string): boolean {
  return commitmentIndicators.some((pattern) => pattern.test(sourceText));
}

function normalizeEntityKind(
  entity: ExtractionPromptEntity,
  hasDecisionCommitmentLanguage: boolean,
): ExtractionPromptEntity {
  if (!hasDecisionCommitmentLanguage || entity.kind !== "feature") {
    return entity;
  }

  return {
    ...entity,
    kind: "decision",
  };
}

function pruneQuestionAlternatives(
  entities: ExtractionPromptEntity[],
  sourceText: string,
): ExtractionPromptEntity[] {
  const questionMarkCount = [...sourceText].filter((char) => char === "?").length;
  if (questionMarkCount !== 1) {
    return entities;
  }

  const questionEntities = entities.filter((entity) => entity.kind === "question");
  if (questionEntities.length !== 1) {
    return entities;
  }

  const [questionEntity] = questionEntities;
  const normalizedQuestionText = normalizeName(questionEntity.text);
  if (normalizedQuestionText.length === 0) {
    return entities;
  }

  return entities.filter((entity) => {
    if (entity.kind === "question") {
      return true;
    }

    const normalizedEntityText = normalizeName(entity.text);
    if (normalizedEntityText.length === 0) {
      return false;
    }

    if (normalizedEntityText.split(" ").length > 4) {
      return true;
    }

    if (!normalizedQuestionText.includes(normalizedEntityText)) {
      return true;
    }

    return entity.confidence > questionEntity.confidence;
  });
}
