import { embed } from "ai";

export async function createEmbeddingVector(
  embeddingModel: Parameters<typeof embed>[0]["model"],
  value: string,
  expectedDimension: number,
): Promise<number[] | undefined> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const result = await embed({
    model: embeddingModel,
    value: normalized,
    abortSignal: AbortSignal.timeout(60_000),
  });

  if (result.embedding.length !== expectedDimension) {
    return undefined;
  }

  return result.embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
