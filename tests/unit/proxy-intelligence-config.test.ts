/**
 * Unit Tests: Intelligence Config (Step 03-02)
 *
 * Tests for the intelligence config loader that reads
 * proxy_intelligence_config from SurrealDB with env-var fallbacks.
 */
import { describe, expect, it } from "bun:test";
import {
  resolveIntelligenceConfig,
  type IntelligenceConfig,
  type RawIntelligenceConfigRow,
} from "../../app/src/server/proxy/intelligence-config";

// ---------------------------------------------------------------------------
// resolveIntelligenceConfig: DB row to domain config
// ---------------------------------------------------------------------------
describe("resolveIntelligenceConfig", () => {
  it("maps DB row to domain config", () => {
    const row: RawIntelligenceConfigRow = {
      context_injection_enabled: true,
      context_injection_token_budget: 2000,
      context_injection_cache_ttl_seconds: 600,
      context_injection_tier: "secure",
      contradiction_detection_enabled: true,
      contradiction_tier1_threshold: 0.75,
      contradiction_tier2_confidence_min: 0.6,
    };

    const config = resolveIntelligenceConfig(row);

    expect(config.contextInjectionEnabled).toBe(true);
    expect(config.contextInjectionTokenBudget).toBe(2000);
    expect(config.contextInjectionCacheTtlSeconds).toBe(600);
    expect(config.contextInjectionTier).toBe("secure");
  });

  it("returns defaults when DB row is undefined (env fallback)", () => {
    const config = resolveIntelligenceConfig(undefined);

    expect(config.contextInjectionEnabled).toBe(false);
    expect(config.contextInjectionTokenBudget).toBe(1000);
    expect(config.contextInjectionCacheTtlSeconds).toBe(300);
    expect(config.contextInjectionTier).toBe("fast");
  });

  it("returns defaults when DB row has disabled context injection", () => {
    const row: RawIntelligenceConfigRow = {
      context_injection_enabled: false,
      context_injection_token_budget: 500,
      context_injection_cache_ttl_seconds: 60,
      context_injection_tier: "fast",
      contradiction_detection_enabled: false,
      contradiction_tier1_threshold: 0.5,
      contradiction_tier2_confidence_min: 0.3,
    };

    const config = resolveIntelligenceConfig(row);

    expect(config.contextInjectionEnabled).toBe(false);
    expect(config.contextInjectionTokenBudget).toBe(500);
  });
});
