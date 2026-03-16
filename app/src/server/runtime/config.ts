export type OpenRouterReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export type OpenRouterReasoningOptions = {
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
  effort?: OpenRouterReasoningEffort;
};

export type InferenceProvider = "openrouter" | "ollama";

export type ServerConfig = {
  inferenceProvider: InferenceProvider;
  openRouterApiKey?: string;
  ollamaBaseUrl?: string;
  chatAgentModelId: string;
  extractionModelId: string;
  pmAgentModelId: string;
  analyticsAgentModelId: string;
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
  observerModelId: string;
  scorerModelId: string;
  githubWebhookSecret?: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  anthropicApiUrl: string;
  anthropicApiKey?: string;
};

export function loadServerConfig(): ServerConfig {
  const inferenceProvider = parseInferenceProvider();

  const openRouterApiKey = inferenceProvider === "openrouter"
    ? requireEnv("OPENROUTER_API_KEY")
    : Bun.env.OPENROUTER_API_KEY?.trim() || undefined;

  const ollamaBaseUrl = inferenceProvider === "ollama"
    ? (Bun.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434")
    : undefined;

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

  const chatAgentModelId = requireEnv("CHAT_AGENT_MODEL");
  const extractionModelId = requireEnv("EXTRACTION_MODEL");
  const pmAgentModelId = Bun.env.PM_AGENT_MODEL && Bun.env.PM_AGENT_MODEL.trim().length > 0
    ? Bun.env.PM_AGENT_MODEL.trim()
    : extractionModelId;
  const analyticsAgentModelId = requireEnv("ANALYTICS_MODEL");
  const embeddingModelId = requireEnv("EMBEDDING_MODEL");
  const embeddingDimension = parsePositiveInteger(requireEnv("EMBEDDING_DIMENSION"), "EMBEDDING_DIMENSION");

  const surrealUrl = requireEnv("SURREAL_URL");
  const surrealUsername = requireEnv("SURREAL_USERNAME");
  const surrealPassword = requireEnv("SURREAL_PASSWORD");
  const surrealNamespace = requireEnv("SURREAL_NAMESPACE");
  const surrealDatabase = requireEnv("SURREAL_DATABASE");

  const port = parsePositiveInteger(requireEnv("PORT"), "PORT");
  const observerModelId = Bun.env.OBSERVER_MODEL && Bun.env.OBSERVER_MODEL.trim().length > 0
    ? Bun.env.OBSERVER_MODEL.trim()
    : extractionModelId;
  const scorerModelId = Bun.env.SCORER_MODEL && Bun.env.SCORER_MODEL.trim().length > 0
    ? Bun.env.SCORER_MODEL.trim()
    : extractionModelId;
  const githubWebhookSecret = Bun.env.GITHUB_WEBHOOK_SECRET?.trim() || undefined;
  const betterAuthSecret = requireEnv("BETTER_AUTH_SECRET");
  const betterAuthUrl = requireEnv("BETTER_AUTH_URL");
  const githubClientId = requireEnv("GITHUB_CLIENT_ID");
  const githubClientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  const anthropicApiUrl = Bun.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com";
  const anthropicApiKey = Bun.env.ANTHROPIC_API_KEY?.trim() || undefined;

  const openRouterReasoning = inferenceProvider === "openrouter"
    ? parseOpenRouterReasoning()
    : undefined;

  return {
    inferenceProvider,
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(ollamaBaseUrl ? { ollamaBaseUrl } : {}),
    chatAgentModelId,
    extractionModelId,
    pmAgentModelId,
    analyticsAgentModelId,
    embeddingModelId,
    embeddingDimension,
    extractionStoreThreshold,
    extractionDisplayThreshold,
    ...(openRouterReasoning ? { openRouterReasoning } : {}),
    surrealUrl,
    surrealUsername,
    surrealPassword,
    surrealNamespace,
    surrealDatabase,
    port,
    observerModelId,
    scorerModelId,
    ...(githubWebhookSecret ? { githubWebhookSecret } : {}),
    betterAuthSecret,
    betterAuthUrl,
    githubClientId,
    githubClientSecret,
    anthropicApiUrl,
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
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

function parseInferenceProvider(): InferenceProvider {
  const value = Bun.env.INFERENCE_PROVIDER?.trim().toLowerCase();
  if (!value || value === "openrouter") return "openrouter";
  if (value === "ollama") return "ollama";
  throw new Error("INFERENCE_PROVIDER must be one of: openrouter, ollama");
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
