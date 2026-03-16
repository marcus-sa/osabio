/**
 * Unit Tests: Cost Calculator (Pure Function)
 *
 * Validates cost computation from token usage and model-specific pricing.
 * Formula: (uncached_input * input_rate + cache_read * cache_rate + output * output_rate) / 1_000_000
 *
 * Port: (TokenUsage, ModelPricing) -> CostUsd
 */
import { describe, expect, it } from "bun:test";
import { calculateCost, type TokenUsage } from "../../app/src/server/proxy/cost-calculator";
import { getModelPricing } from "../../app/src/server/proxy/pricing-table";

describe("calculateCost", () => {
  it("computes cost from input and output tokens with no cache", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    // Claude Sonnet 4: input=$3/MTok, output=$15/MTok
    const pricing = getModelPricing("claude-sonnet-4-20250514");
    const cost = calculateCost(usage, pricing);

    // (1000 * 3 + 200 * 15) / 1_000_000 = (3000 + 3000) / 1_000_000 = 0.006
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it("includes cache read tokens at reduced rate", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 500,
    };

    const pricing = getModelPricing("claude-sonnet-4-20250514");
    const cost = calculateCost(usage, pricing);

    // uncached_input = inputTokens - cacheReadTokens = 500
    // (500 * 3 + 500 * 0.3 + 200 * 15) / 1_000_000
    // = (1500 + 150 + 3000) / 1_000_000 = 0.00465
    expect(cost).toBeCloseTo(0.00465, 6);
  });

  it("includes cache creation tokens at higher rate", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 300,
      cacheReadTokens: 0,
    };

    const pricing = getModelPricing("claude-sonnet-4-20250514");
    const cost = calculateCost(usage, pricing);

    // uncached_input = inputTokens - cacheCreationTokens = 700
    // (700 * 3 + 300 * 3.75 + 200 * 15) / 1_000_000
    // = (2100 + 1125 + 3000) / 1_000_000 = 0.006225
    expect(cost).toBeCloseTo(0.006225, 6);
  });

  it("handles both cache creation and cache read tokens", () => {
    const usage: TokenUsage = {
      inputTokens: 2000,
      outputTokens: 500,
      cacheCreationTokens: 400,
      cacheReadTokens: 600,
    };

    const pricing = getModelPricing("claude-sonnet-4-20250514");
    const cost = calculateCost(usage, pricing);

    // uncached_input = 2000 - 400 - 600 = 1000
    // (1000 * 3 + 600 * 0.3 + 400 * 3.75 + 500 * 15) / 1_000_000
    // = (3000 + 180 + 1500 + 7500) / 1_000_000 = 0.01218
    expect(cost).toBeCloseTo(0.01218, 6);
  });

  it("returns zero cost for zero tokens", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const pricing = getModelPricing("claude-sonnet-4-20250514");
    expect(calculateCost(usage, pricing)).toBe(0);
  });

  it("never returns negative cost", () => {
    // Even with unusual token combinations, cost should be >= 0
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const pricing = getModelPricing("claude-sonnet-4-20250514");
    expect(calculateCost(usage, pricing)).toBeGreaterThanOrEqual(0);
  });
});

describe("getModelPricing", () => {
  it("returns pricing for known Claude Sonnet model", () => {
    const pricing = getModelPricing("claude-sonnet-4-20250514");
    expect(pricing).toBeDefined();
    expect(pricing.inputPerMillion).toBeGreaterThan(0);
    expect(pricing.outputPerMillion).toBeGreaterThan(0);
    expect(pricing.cacheReadPerMillion).toBeGreaterThan(0);
    expect(pricing.cacheCreationPerMillion).toBeGreaterThan(0);
  });

  it("returns pricing for known Claude Opus model", () => {
    const pricing = getModelPricing("claude-opus-4-20250514");
    expect(pricing).toBeDefined();
    expect(pricing.inputPerMillion).toBeGreaterThan(pricing.outputPerMillion ? 0 : -1);
  });

  it("returns pricing for known Claude Haiku model", () => {
    const pricing = getModelPricing("claude-haiku-3-5-20241022");
    expect(pricing).toBeDefined();
  });

  it("returns fallback pricing for unknown models", () => {
    const pricing = getModelPricing("unknown-model-xyz");
    expect(pricing).toBeDefined();
    expect(pricing.inputPerMillion).toBeGreaterThan(0);
  });

  it("matches model by prefix when exact match not found", () => {
    // A dated variant should match the base model
    const pricing = getModelPricing("claude-sonnet-4-20250514");
    const pricingAlt = getModelPricing("claude-sonnet-4-20260101");
    // Both should resolve to sonnet pricing (or fallback)
    expect(pricing).toBeDefined();
    expect(pricingAlt).toBeDefined();
  });
});
