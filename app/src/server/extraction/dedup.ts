import { normalizeName } from "./normalize";

export type DedupOutcome = "merge" | "possible_duplicate" | "independent";

export function classifyDedupSimilarity(similarity: number): DedupOutcome {
  if (similarity > 0.95) {
    return "merge";
  }

  if (similarity >= 0.8 && similarity <= 0.95) {
    return "possible_duplicate";
  }

  return "independent";
}

export function isRicherEntityName(incomingName: string, existingName: string): boolean {
  const normalizedIncoming = normalizeName(incomingName);
  const normalizedExisting = normalizeName(existingName);
  if (normalizedIncoming.length === 0 || normalizedExisting.length === 0) {
    return false;
  }

  const incomingWords = normalizedIncoming.split(" ").filter((word) => word.length > 0);
  const existingWords = normalizedExisting.split(" ").filter((word) => word.length > 0);
  if (incomingWords.length <= existingWords.length) {
    return false;
  }

  return normalizedIncoming.length > normalizedExisting.length;
}

export function pickRicherEntityName(incomingName: string, existingName: string): string {
  return isRicherEntityName(incomingName, existingName) ? incomingName : existingName;
}
