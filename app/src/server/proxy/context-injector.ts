/**
 * Context Injector -- Pure functions for brain-context injection
 *
 * Responsible for:
 * 1. Ranking context candidates by weighted cosine similarity
 * 2. Selecting top N within token budget
 * 3. Building <brain-context> XML block
 * 4. Injecting into system prompt (string or array form)
 *
 * All functions are pure -- no IO, no side effects.
 * The orchestration (embedding, cache, DB queries) lives in the proxy route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCandidate = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly embedding?: number[];
  readonly weight: number;
};

export type RankedCandidate = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly score: number;
};

export type InjectionResult = {
  readonly system: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
  readonly injected: boolean;
  readonly tokensEstimated: number;
  readonly decisionsCount: number;
  readonly learningsCount: number;
  readonly observationsCount: number;
};

type SystemPrompt = string | Array<{ type: string; text: string; cache_control?: { type: string } }> | undefined;

import { cosineSimilarity } from "../graph/embeddings";

// ---------------------------------------------------------------------------
// Token Estimation (pure, ~4 chars per token)
// ---------------------------------------------------------------------------

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Ranking: weighted cosine similarity
// ---------------------------------------------------------------------------

export function rankCandidates(
  candidates: ContextCandidate[],
  queryEmbedding: number[],
): RankedCandidate[] {
  return candidates
    .map((c) => {
      // Candidates with embeddings get similarity-weighted scores;
      // candidates without embeddings fall back to a baseline weight
      // (half their type weight) so they're still included but ranked lower.
      const hasEmbedding = c.embedding !== undefined && c.embedding.length > 0;
      const score = hasEmbedding
        ? cosineSimilarity(c.embedding!, queryEmbedding) * c.weight
        : c.weight * 0.5;
      return { id: c.id, type: c.type, text: c.text, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Budget Selection: top N within token budget
// ---------------------------------------------------------------------------

export function selectWithinBudget(
  ranked: RankedCandidate[],
  tokenBudget: number,
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  let tokensUsed = 0;

  for (const candidate of ranked) {
    const candidateTokens = estimateTokenCount(candidate.text);
    if (tokensUsed + candidateTokens > tokenBudget) break;
    selected.push(candidate);
    tokensUsed += candidateTokens;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// XML Block Construction
// ---------------------------------------------------------------------------

export function buildBrainContextXml(selected: RankedCandidate[]): string {
  if (selected.length === 0) return "";

  const decisions = selected.filter((c) => c.type === "decision");
  const learnings = selected.filter((c) => c.type === "learning");
  const observations = selected.filter((c) => c.type === "observation");

  const sections: string[] = [];

  if (decisions.length > 0) {
    const items = decisions.map((d) => `  <item>${d.text}</item>`).join("\n");
    sections.push(`<decisions>\n${items}\n</decisions>`);
  }

  if (learnings.length > 0) {
    const items = learnings.map((l) => `  <item>${l.text}</item>`).join("\n");
    sections.push(`<learnings>\n${items}\n</learnings>`);
  }

  if (observations.length > 0) {
    const items = observations.map((o) => `  <item>${o.text}</item>`).join("\n");
    sections.push(`<observations>\n${items}\n</observations>`);
  }

  return `<brain-context>\n${sections.join("\n")}\n</brain-context>`;
}

// ---------------------------------------------------------------------------
// System Prompt Injection
// ---------------------------------------------------------------------------

export function injectBrainContext(
  originalSystem: SystemPrompt,
  brainContextXml: string,
): InjectionResult {
  if (!brainContextXml) {
    return {
      system: originalSystem ?? "",
      injected: false,
      tokensEstimated: 0,
      decisionsCount: 0,
      learningsCount: 0,
      observationsCount: 0,
    };
  }

  const tokensEstimated = estimateTokenCount(brainContextXml);

  // Count items in XML (by counting <item> tags per section)
  const decisionsCount = (brainContextXml.match(/<decisions>[\s\S]*?<\/decisions>/)?.[0]?.match(/<item>/g) ?? []).length;
  const learningsCount = (brainContextXml.match(/<learnings>[\s\S]*?<\/learnings>/)?.[0]?.match(/<item>/g) ?? []).length;
  const observationsCount = (brainContextXml.match(/<observations>[\s\S]*?<\/observations>/)?.[0]?.match(/<item>/g) ?? []).length;

  if (Array.isArray(originalSystem)) {
    // Array-form: append brain-context as additional text block with cache_control: ephemeral
    const enriched = [
      ...originalSystem,
      {
        type: "text",
        text: brainContextXml,
        cache_control: { type: "ephemeral" },
      },
    ];

    return {
      system: enriched,
      injected: true,
      tokensEstimated,
      decisionsCount,
      learningsCount,
      observationsCount,
    };
  }

  if (typeof originalSystem === "string") {
    // String-form: append brain-context after original text
    return {
      system: `${originalSystem}\n\n${brainContextXml}`,
      injected: true,
      tokensEstimated,
      decisionsCount,
      learningsCount,
      observationsCount,
    };
  }

  // No original system prompt: use brain-context as system prompt
  return {
    system: brainContextXml,
    injected: true,
    tokensEstimated,
    decisionsCount,
    learningsCount,
    observationsCount,
  };
}
