/**
 * Model listing handler -- returns configured model IDs and providers
 * without exposing API keys.
 *
 * Pure function: reads from ServerConfig (injected via deps), no IO.
 */
import type { MethodHandler } from "../method-dispatch";
import type { ServerConfig } from "../../runtime/config";

// ---------------------------------------------------------------------------
// ModelInfo -- the shape returned per configured model
// ---------------------------------------------------------------------------

type ModelInfo = {
  readonly id: string;
  readonly provider: string;
  readonly role: string;
};

// ---------------------------------------------------------------------------
// Pure extraction: ServerConfig -> ModelInfo[]
// ---------------------------------------------------------------------------

export function extractConfiguredModels(config: ServerConfig): ReadonlyArray<ModelInfo> {
  const provider = config.inferenceProvider;

  const modelEntries: ReadonlyArray<{ id: string; role: string }> = [
    { id: config.chatAgentModelId, role: "chat" },
    { id: config.extractionModelId, role: "extraction" },
    { id: config.pmAgentModelId, role: "pm" },
    { id: config.analyticsAgentModelId, role: "analytics" },
    { id: config.observerModelId, role: "observer" },
    { id: config.scorerModelId, role: "scorer" },
  ];

  // Deduplicate by model ID -- same model may serve multiple roles
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const entry of modelEntries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      models.push({ id: entry.id, provider, role: entry.role });
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createModelListHandler(): MethodHandler {
  return async (_connection, _params, deps) => {
    const models = extractConfiguredModels(deps.config);

    return {
      ok: true,
      payload: { models },
    };
  };
}
