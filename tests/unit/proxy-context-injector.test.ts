/**
 * Unit Tests: Context Injector (Step 03-02)
 *
 * Pure function tests for context injection logic:
 * - Ranking candidates by weighted cosine similarity
 * - Selecting top N within token budget
 * - Building <brain-context> XML block
 * - Injecting into system prompt (string and array forms)
 * - Estimating token count
 */
import { describe, expect, it } from "bun:test";
import {
  rankCandidates,
  selectWithinBudget,
  buildBrainContextXml,
  injectBrainContext,
  estimateTokenCount,
  type ContextCandidate,
  type RankedCandidate,
  type InjectionResult,
} from "../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// Test Data Factories
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ContextCandidate> = {}): ContextCandidate {
  return {
    id: overrides.id ?? `test-${crypto.randomUUID()}`,
    type: overrides.type ?? "decision",
    text: overrides.text ?? "Use TypeScript for all new services",
    embedding: overrides.embedding ?? [0.1, 0.2, 0.3],
    weight: overrides.weight ?? 1.0,
  };
}

function makeQueryEmbedding(): number[] {
  return [0.1, 0.2, 0.3];
}

// ---------------------------------------------------------------------------
// rankCandidates: weighted cosine similarity ranking
// ---------------------------------------------------------------------------
describe("rankCandidates", () => {
  it("ranks candidates by weighted cosine similarity descending", () => {
    const queryEmbedding = [1, 0, 0];
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "low", embedding: [0, 1, 0], weight: 1.0 }), // orthogonal
      makeCandidate({ id: "high", embedding: [1, 0, 0], weight: 1.0 }), // identical direction
      makeCandidate({ id: "mid", embedding: [0.7, 0.7, 0], weight: 1.0 }), // ~45 degrees
    ];

    const ranked = rankCandidates(candidates, queryEmbedding);

    expect(ranked[0].id).toBe("high");
    expect(ranked[1].id).toBe("mid");
    expect(ranked[2].id).toBe("low");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("applies weight multiplier to similarity score", () => {
    const queryEmbedding = [1, 0, 0];
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "high-sim-low-weight", embedding: [1, 0, 0], weight: 0.5 }),
      makeCandidate({ id: "mid-sim-high-weight", embedding: [0.7, 0.7, 0], weight: 1.0 }),
    ];

    const ranked = rankCandidates(candidates, queryEmbedding);

    // 1.0 * 0.5 = 0.5 vs ~0.707 * 1.0 = 0.707
    expect(ranked[0].id).toBe("mid-sim-high-weight");
    expect(ranked[1].id).toBe("high-sim-low-weight");
  });

  it("skips candidates without embeddings", () => {
    const queryEmbedding = [1, 0, 0];
    const candidates: ContextCandidate[] = [
      { id: "has-embedding", type: "decision", text: "text", embedding: [1, 0, 0], weight: 1.0 },
      { id: "no-embedding", type: "decision", text: "text", embedding: undefined, weight: 1.0 },
    ];

    const ranked = rankCandidates(candidates, queryEmbedding);

    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe("has-embedding");
  });

  it("returns empty array for empty candidates", () => {
    const ranked = rankCandidates([], [1, 0, 0]);
    expect(ranked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectWithinBudget: token budget enforcement
// ---------------------------------------------------------------------------
describe("selectWithinBudget", () => {
  it("selects candidates until token budget is exhausted", () => {
    const ranked: RankedCandidate[] = [
      { id: "a", type: "decision", text: "Short text", score: 0.9 },
      { id: "b", type: "learning", text: "Another short text", score: 0.8 },
      { id: "c", type: "observation", text: "A very long text ".repeat(100), score: 0.7 },
    ];

    // Budget of 30 tokens should fit first two but not the long third
    const selected = selectWithinBudget(ranked, 30);

    expect(selected.length).toBe(2);
    expect(selected[0].id).toBe("a");
    expect(selected[1].id).toBe("b");
  });

  it("returns empty array when budget is zero", () => {
    const ranked: RankedCandidate[] = [
      { id: "a", type: "decision", text: "Text", score: 0.9 },
    ];

    const selected = selectWithinBudget(ranked, 0);
    expect(selected).toEqual([]);
  });

  it("includes at least one candidate if it fits budget", () => {
    const ranked: RankedCandidate[] = [
      { id: "a", type: "decision", text: "Short", score: 0.9 },
    ];

    const selected = selectWithinBudget(ranked, 100);
    expect(selected.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildBrainContextXml: XML block construction
// ---------------------------------------------------------------------------
describe("buildBrainContextXml", () => {
  it("builds XML with decisions, learnings, and observations sections", () => {
    const selected: RankedCandidate[] = [
      { id: "d1", type: "decision", text: "Use tRPC", score: 0.9 },
      { id: "l1", type: "learning", text: "Always use DPoP", score: 0.8 },
      { id: "o1", type: "observation", text: "Auth drift detected", score: 0.7 },
    ];

    const xml = buildBrainContextXml(selected);

    expect(xml).toContain("<brain-context>");
    expect(xml).toContain("</brain-context>");
    expect(xml).toContain("<decisions>");
    expect(xml).toContain("Use tRPC");
    expect(xml).toContain("<learnings>");
    expect(xml).toContain("Always use DPoP");
    expect(xml).toContain("<observations>");
    expect(xml).toContain("Auth drift detected");
  });

  it("omits empty sections", () => {
    const selected: RankedCandidate[] = [
      { id: "d1", type: "decision", text: "Use tRPC", score: 0.9 },
    ];

    const xml = buildBrainContextXml(selected);

    expect(xml).toContain("<decisions>");
    expect(xml).not.toContain("<learnings>");
    expect(xml).not.toContain("<observations>");
  });

  it("returns empty string for no candidates", () => {
    const xml = buildBrainContextXml([]);
    expect(xml).toBe("");
  });
});

// ---------------------------------------------------------------------------
// injectBrainContext: system prompt modification
// ---------------------------------------------------------------------------
describe("injectBrainContext", () => {
  it("appends brain-context to string system prompt", () => {
    const original = "You are a helpful assistant.";
    const brainContext = "<brain-context><decisions><item>Use tRPC</item></decisions></brain-context>";

    const result = injectBrainContext(original, brainContext);

    expect(result.system).toContain("You are a helpful assistant.");
    expect(result.system).toContain(brainContext);
    // Original text comes first
    const systemStr = result.system as string;
    expect(systemStr.indexOf("You are a helpful assistant.")).toBeLessThan(
      systemStr.indexOf("<brain-context>"),
    );
  });

  it("appends brain-context as additional text block to array system prompt", () => {
    const original = [
      { type: "text", text: "You are an expert.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Follow clean code." },
    ];
    const brainContext = "<brain-context><decisions><item>Use tRPC</item></decisions></brain-context>";

    const result = injectBrainContext(original, brainContext);

    const systemArr = result.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    expect(Array.isArray(systemArr)).toBe(true);
    // Original blocks preserved
    expect(systemArr[0].text).toBe("You are an expert.");
    expect(systemArr[0].cache_control).toEqual({ type: "ephemeral" });
    expect(systemArr[1].text).toBe("Follow clean code.");
    // Brain context appended as last block with cache_control: ephemeral
    const lastBlock = systemArr[systemArr.length - 1];
    expect(lastBlock.text).toContain("<brain-context>");
    expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("creates string system prompt when original is undefined", () => {
    const brainContext = "<brain-context><decisions><item>Use tRPC</item></decisions></brain-context>";

    const result = injectBrainContext(undefined, brainContext);

    expect(typeof result.system).toBe("string");
    expect(result.system).toBe(brainContext);
  });

  it("returns original unchanged when brain-context is empty", () => {
    const original = "You are a helpful assistant.";

    const result = injectBrainContext(original, "");

    expect(result.system).toBe(original);
    expect(result.injected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// estimateTokenCount: rough char/4 estimation
// ---------------------------------------------------------------------------
describe("estimateTokenCount", () => {
  it("estimates tokens as approximately chars/4", () => {
    const text = "a".repeat(100);
    const estimate = estimateTokenCount(text);
    expect(estimate).toBe(25); // 100 / 4
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });
});
