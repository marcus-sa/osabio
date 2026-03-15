/**
 * Cost Calculator — Pure function for computing per-call LLM costs
 *
 * Port: (TokenUsage, ModelPricing) -> number (USD)
 *
 * Formula:
 *   uncached_input = inputTokens - cacheReadTokens - cacheCreationTokens
 *   cost = (uncached_input * input_rate
 *         + cacheReadTokens * cache_read_rate
 *         + cacheCreationTokens * cache_creation_rate
 *         + outputTokens * output_rate) / 1_000_000
 */

import type { ModelPricing } from "./pricing-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
};

// ---------------------------------------------------------------------------
// Pure Function
// ---------------------------------------------------------------------------

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Compute the USD cost for an LLM call given token usage and model pricing.
 *
 * Input tokens reported by the API include cached tokens. We decompose:
 * - cacheReadTokens: charged at the reduced cache_read rate
 * - cacheCreationTokens: charged at the elevated cache_creation rate
 * - uncachedInput: remaining input tokens at the standard input rate
 */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheCreationTokens,
  );

  const totalCostMicro =
    uncachedInput * pricing.inputPerMillion +
    usage.cacheReadTokens * pricing.cacheReadPerMillion +
    usage.cacheCreationTokens * pricing.cacheCreationPerMillion +
    usage.outputTokens * pricing.outputPerMillion;

  return totalCostMicro / TOKENS_PER_MILLION;
}
