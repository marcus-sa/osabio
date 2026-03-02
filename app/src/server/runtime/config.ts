export type OpenRouterReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export type OpenRouterReasoningOptions = {
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
  effort?: OpenRouterReasoningEffort;
};

export type ServerConfig = {
  openRouterApiKey: string;
  assistantModelId: string;
  extractionModelId: string;
  pmModelId: string;
  embeddingModelId: string;
  embeddingDimension: number;
  extractionStoreThreshold: number;
  extractionDisplayThreshold: number;
  openRouterReasoning?: OpenRouterReasoningOptions;
  surrealUrl: string;
  surrealUsername: string;
  surrealPassword: string;
  surrealNamespace: string;
  surrealDatabase: string;
  port: number;
  githubWebhookSecret?: string;
};

export function loadServerConfig(): ServerConfig {
  const openRouterApiKey = requireEnv("OPENROUTER_API_KEY");

  const extractionStoreThreshold = parseUnitInterval(
    requireEnv("EXTRACTION_STORE_THRESHOLD"),
    "EXTRACTION_STORE_THRESHOLD",
  );

  const extractionDisplayThreshold = parseUnitInterval(
    requireEnv("EXTRACTION_DISPLAY_THRESHOLD"),
    "EXTRACTION_DISPLAY_THRESHOLD",
  );

  if (extractionDisplayThreshold < extractionStoreThreshold) {
    throw new Error("EXTRACTION_DISPLAY_THRESHOLD must be greater than or equal to EXTRACTION_STORE_THRESHOLD");
  }

  const assistantModelId = requireEnv("ASSISTANT_MODEL");
  const extractionModelId = requireEnv("EXTRACTION_MODEL");
  const pmModelId = Bun.env.PM_MODEL && Bun.env.PM_MODEL.trim().length > 0
    ? Bun.env.PM_MODEL.trim()
    : extractionModelId;
  const embeddingModelId = requireEnv("OPENROUTER_EMBEDDING_MODEL");
  const embeddingDimension = parsePositiveInteger(requireEnv("EMBEDDING_DIMENSION"), "EMBEDDING_DIMENSION");

  const surrealUrl = requireEnv("SURREAL_URL");
  const surrealUsername = requireEnv("SURREAL_USERNAME");
  const surrealPassword = requireEnv("SURREAL_PASSWORD");
  const surrealNamespace = requireEnv("SURREAL_NAMESPACE");
  const surrealDatabase = requireEnv("SURREAL_DATABASE");

  const port = parsePositiveInteger(requireEnv("PORT"), "PORT");
  const githubWebhookSecret = Bun.env.GITHUB_WEBHOOK_SECRET?.trim() || undefined;

  return {
    openRouterApiKey,
    assistantModelId,
    extractionModelId,
    pmModelId,
    embeddingModelId,
    embeddingDimension,
    extractionStoreThreshold,
    extractionDisplayThreshold,
    openRouterReasoning: parseOpenRouterReasoning(),
    surrealUrl,
    surrealUsername,
    surrealPassword,
    surrealNamespace,
    surrealDatabase,
    port,
    ...(githubWebhookSecret ? { githubWebhookSecret } : {}),
  };
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parsePositiveInteger(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseUnitInterval(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${envName} must be a number between 0 and 1`);
  }

  return parsed;
}

function parseOpenRouterReasoning(): OpenRouterReasoningOptions | undefined {
  const effortValue = Bun.env.OPENROUTER_REASONING_EFFORT;
  const maxTokensValue = Bun.env.OPENROUTER_REASONING_MAX_TOKENS;

  if (!effortValue && !maxTokensValue) {
    return undefined;
  }

  const reasoning: OpenRouterReasoningOptions = {};

  if (effortValue) {
    const allowedEfforts: OpenRouterReasoningEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];

    if (!allowedEfforts.includes(effortValue as OpenRouterReasoningEffort)) {
      throw new Error("OPENROUTER_REASONING_EFFORT must be one of xhigh, high, medium, low, minimal, none");
    }
    reasoning.effort = effortValue as OpenRouterReasoningEffort;
  }

  if (maxTokensValue) {
    const parsed = Number(maxTokensValue);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("OPENROUTER_REASONING_MAX_TOKENS must be a positive number");
    }
    reasoning.max_tokens = parsed;
  }

  return reasoning;
}
