import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider";
import { wrapLanguageModel } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import { createAuth, type Auth } from "../auth/config";
import { bootstrapSigningKeyFromSurreal, type AsSigningKey } from "../oauth/as-key-management";
import { createMcpClientFactory, type McpClientFactory } from "../tool-registry/mcp-client";
import type { SandboxAgentAdapter } from "../orchestrator/sandbox-adapter";

const devtools = process.env.AI_DEVTOOLS === "1" ? devToolsMiddleware() : undefined;

export async function createRuntimeDependencies(config: ServerConfig): Promise<{
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  observerModel: any;
  scorerModel: any;
  asSigningKey: AsSigningKey;
  mcpClientFactory: McpClientFactory;
  sandboxAgentAdapter?: SandboxAgentAdapter;
  destroySandbox?: () => Promise<void>;
}> {
  const surreal = new Surreal();
  await surreal.connect(config.surrealUrl, {
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    authentication: () => ({
      username: config.surrealUsername,
      password: config.surrealPassword,
    }),
  });
  await surreal.signin({ username: config.surrealUsername, password: config.surrealPassword });
  await surreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const analyticsSurreal = new Surreal();
  await analyticsSurreal.connect(config.surrealUrl, {
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    authentication: () => ({
      namespace: config.surrealNamespace,
      database: config.surrealDatabase,
      username: "analytics",
      password: "brain-analytics-readonly",
    }),
  });
  await analyticsSurreal.signin({
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    username: "analytics",
    password: "brain-analytics-readonly",
  });
  await analyticsSurreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const wrap = (model: any) => devtools ? wrapLanguageModel({ model, middleware: devtools }) : model;

  const { chatAgentModel, extractionModel, pmAgentModel, analyticsAgentModel, observerModel, scorerModel } =
    config.inferenceProvider === "ollama"
      ? createOllamaModels(config, wrap)
      : createOpenRouterModels(config, wrap);

  const auth = createAuth(surreal, {
    betterAuthSecret: config.betterAuthSecret,
    betterAuthUrl: config.betterAuthUrl,
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
    selfHosted: config.selfHosted,
  });

  const asSigningKey = await bootstrapSigningKeyFromSurreal(surreal);
  const mcpClientFactory = createMcpClientFactory();

  // SandboxAgent SDK — start embedded server when enabled
  // When orchestratorMockAgent is true, use mock adapter instead of real SDK
  // (acceptance tests set both sandboxAgentEnabled + orchestratorMockAgent)
  let sandboxAgentAdapter: SandboxAgentAdapter | undefined;
  let destroySandbox: (() => Promise<void>) | undefined;
  if (config.sandboxAgentEnabled && !config.orchestratorMockAgent) {
    const { SandboxAgent: SandboxAgentClass } = await import("sandbox-agent");
    const { local } = await import("sandbox-agent/local");
    const { createSandboxAgentAdapter } = await import("../orchestrator/sandbox-adapter");
    const sdk = await SandboxAgentClass.start({ sandbox: local() });
    sandboxAgentAdapter = createSandboxAgentAdapter(sdk);
    destroySandbox = () => sdk.destroySandbox();
  } else if (config.sandboxAgentEnabled && config.orchestratorMockAgent) {
    const { createMockAdapter } = await import("../orchestrator/sandbox-adapter");
    sandboxAgentAdapter = createMockAdapter();
  }

  return {
    surreal,
    analyticsSurreal,
    auth,
    chatAgentModel,
    extractionModel,
    pmAgentModel,
    analyticsAgentModel,
    observerModel,
    scorerModel,
    asSigningKey,
    mcpClientFactory,
    sandboxAgentAdapter,
    destroySandbox,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter model factory
// ---------------------------------------------------------------------------

function createOpenRouterModels(config: ServerConfig, wrap: (model: any) => any) {
  const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey! });
  const withPlugins = (modelId: string, reasoning = true) =>
    wrap(openrouter(modelId, {
      plugins: [{ id: "response-healing" }],
      ...(reasoning && config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
    }));

  return {
    chatAgentModel: withPlugins(config.chatAgentModelId),
    extractionModel: withPlugins(config.extractionModelId),
    pmAgentModel: withPlugins(config.pmAgentModelId),
    analyticsAgentModel: withPlugins(config.analyticsAgentModelId, false),
    observerModel: withPlugins(config.observerModelId),
    scorerModel: withPlugins(config.scorerModelId, false),
  };
}

// ---------------------------------------------------------------------------
// Ollama model factory
// ---------------------------------------------------------------------------

function createOllamaModels(config: ServerConfig, wrap: (model: any) => any) {
  const ollama = createOllama({ baseURL: `${config.ollamaBaseUrl}/api` });

  return {
    chatAgentModel: wrap(ollama(config.chatAgentModelId)),
    extractionModel: wrap(ollama(config.extractionModelId)),
    pmAgentModel: wrap(ollama(config.pmAgentModelId)),
    analyticsAgentModel: wrap(ollama(config.analyticsAgentModelId)),
    observerModel: wrap(ollama(config.observerModelId)),
    scorerModel: wrap(ollama(config.scorerModelId)),
  };
}
