/**
 * Pricing Table — Static model pricing configuration
 *
 * Per-model rates in USD per million tokens for input, output,
 * cache_creation, and cache_read. Used by cost-calculator to compute
 * per-call costs at trace capture time.
 *
 * Rates sourced from Anthropic's published pricing (as of 2025-05).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelPricing = {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheCreationPerMillion: number;
  readonly cacheReadPerMillion: number;
};

// ---------------------------------------------------------------------------
// Static Pricing Table
// ---------------------------------------------------------------------------

const PRICING_TABLE: ReadonlyMap<string, ModelPricing> = new Map([
  // Claude Opus 4
  ["claude-opus-4", {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheCreationPerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  }],
  // Claude Sonnet 4
  ["claude-sonnet-4", {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  }],
  // Claude Haiku 3.5
  ["claude-haiku-3-5", {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheCreationPerMillion: 1,
    cacheReadPerMillion: 0.08,
  }],
  // Claude Sonnet 3.5 (legacy)
  ["claude-3-5-sonnet", {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  }],
  // Claude Haiku 3 (legacy)
  ["claude-3-haiku", {
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    cacheCreationPerMillion: 0.3,
    cacheReadPerMillion: 0.03,
  }],
]);

const FALLBACK_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheCreationPerMillion: 3.75,
  cacheReadPerMillion: 0.3,
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Get pricing for a model by exact match or prefix match.
 *
 * Lookup strategy:
 * 1. Exact match against the full model ID
 * 2. Prefix match — strips date suffixes (e.g. "-20250514") and retries
 * 3. Falls back to Sonnet-tier pricing as a safe default
 */
export function getModelPricing(modelId: string): ModelPricing {
  // 1. Exact match
  const exact = PRICING_TABLE.get(modelId);
  if (exact) return exact;

  // 2. Prefix match — try progressively shorter prefixes
  for (const [key, pricing] of PRICING_TABLE) {
    if (modelId.startsWith(key)) return pricing;
  }

  // 3. Fallback
  return FALLBACK_PRICING;
}
