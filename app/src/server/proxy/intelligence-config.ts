/**
 * Intelligence Config Loader
 *
 * Reads proxy_intelligence_config per workspace from SurrealDB.
 * Falls back to env-var defaults when no config exists.
 *
 * Port: (workspaceId, Surreal) -> Promise<IntelligenceConfig>
 * Pure mapping: (RawRow | undefined) -> IntelligenceConfig
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { logWarn } from "../http/observability";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RawIntelligenceConfigRow = {
  readonly context_injection_enabled: boolean;
  readonly context_injection_token_budget: number;
  readonly context_injection_cache_ttl_seconds: number;
  readonly context_injection_tier: string;
  readonly contradiction_detection_enabled: boolean;
  readonly contradiction_tier1_threshold: number;
  readonly contradiction_tier2_confidence_min: number;
};

export type IntelligenceConfig = {
  readonly contextInjectionEnabled: boolean;
  readonly contextInjectionTokenBudget: number;
  readonly contextInjectionCacheTtlSeconds: number;
  readonly contextInjectionTier: string;
};

// ---------------------------------------------------------------------------
// Defaults (env-var fallback)
// ---------------------------------------------------------------------------

const DEFAULTS: IntelligenceConfig = {
  contextInjectionEnabled: false,
  contextInjectionTokenBudget: 1000,
  contextInjectionCacheTtlSeconds: 300,
  contextInjectionTier: "fast",
};

// ---------------------------------------------------------------------------
// Pure mapping: DB row -> domain config
// ---------------------------------------------------------------------------

export function resolveIntelligenceConfig(
  row: RawIntelligenceConfigRow | undefined,
): IntelligenceConfig {
  if (!row) return DEFAULTS;

  return {
    contextInjectionEnabled: row.context_injection_enabled,
    contextInjectionTokenBudget: row.context_injection_token_budget,
    contextInjectionCacheTtlSeconds: row.context_injection_cache_ttl_seconds,
    contextInjectionTier: row.context_injection_tier,
  };
}

// ---------------------------------------------------------------------------
// DB loader (adapter boundary)
// ---------------------------------------------------------------------------

export async function loadIntelligenceConfig(
  surreal: Surreal,
  workspaceId: string,
): Promise<IntelligenceConfig> {
  try {
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const results = await surreal.query<[RawIntelligenceConfigRow[]]>(
      `SELECT
        context_injection_enabled,
        context_injection_token_budget,
        context_injection_cache_ttl_seconds,
        context_injection_tier,
        contradiction_detection_enabled,
        contradiction_tier1_threshold,
        contradiction_tier2_confidence_min
      FROM proxy_intelligence_config
      WHERE workspace = $ws
      LIMIT 1;`,
      { ws: workspaceRecord },
    );

    const row = results[0]?.[0];
    return resolveIntelligenceConfig(row);
  } catch (error) {
    logWarn("proxy.intelligence_config.load_failed", "Failed to load intelligence config, using defaults", {
      workspace_id: workspaceId,
      error: String(error),
    });
    return DEFAULTS;
  }
}
