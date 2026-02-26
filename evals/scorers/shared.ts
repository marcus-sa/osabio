function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

export function nameSimilarity(a: string, b: string): number {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  const aTokens = new Set(tokenize(normalizedA));
  const bTokens = new Set(tokenize(normalizedB));

  if (normalizedA.length === 0 || normalizedB.length === 0 || aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const minSize = Math.min(aTokens.size, bTokens.size);
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = overlap / union;
  const overlapRatio = overlap / minSize;
  const substringBonus = normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA) ? 0.2 : 0;
  const exactBonus = normalizedA === normalizedB ? 0.2 : 0;

  return Math.min(1, Math.max(jaccard, overlapRatio * 0.85) + substringBonus + exactBonus);
}

export function isEntityNameMatch(a: string, b: string, threshold = 0.5): boolean {
  return nameSimilarity(a, b) >= threshold;
}

export function normalizeForSubstring(value: string): string {
  return normalize(value);
}
