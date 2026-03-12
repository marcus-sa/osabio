import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import { createAuth, type Auth } from "../auth/config";
import { bootstrapSigningKeyFromSurreal, type AsSigningKey } from "../oauth/as-key-management";

const devtools = process.env.AI_DEVTOOLS === "1" ? devToolsMiddleware() : undefined;

export async function createRuntimeDependencies(config: ServerConfig): Promise<{
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  embeddingModel: any;
  observerModel?: any;
  asSigningKey: AsSigningKey;
}> {
  const surreal = new Surreal();
  await surreal.connect(config.surrealUrl);
  await surreal.signin({ username: config.surrealUsername, password: config.surrealPassword });
  await surreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const analyticsSurreal = new Surreal();
  await analyticsSurreal.connect(config.surrealUrl);
  await analyticsSurreal.signin({
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    username: "analytics",
    password: "brain-analytics-readonly",
  });
  await analyticsSurreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
  const wrap = (model: any) => devtools ? wrapLanguageModel({ model, middleware: devtools }) : model;
  const chatAgentModel = wrap(openrouter(config.chatAgentModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  }));
  const extractionModel = wrap(openrouter(config.extractionModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  }));
  const pmAgentModel = wrap(openrouter(config.pmAgentModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  }));
  const analyticsAgentModel = wrap(openrouter(config.analyticsAgentModelId, {
    plugins: [{ id: "response-healing" }],
  }));
  const embeddingModel = openrouter.textEmbeddingModel(config.embeddingModelId);
  const observerModel = config.observerModelId
    ? wrap(openrouter(config.observerModelId, {
        plugins: [{ id: "response-healing" }],
        ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
      }))
    : undefined;

  const auth = createAuth(surreal, {
    betterAuthSecret: config.betterAuthSecret,
    betterAuthUrl: config.betterAuthUrl,
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
  });

  const asSigningKey = await bootstrapSigningKeyFromSurreal(surreal);

  return {
    surreal,
    analyticsSurreal,
    auth,
    chatAgentModel,
    extractionModel,
    pmAgentModel,
    analyticsAgentModel,
    embeddingModel,
    ...(observerModel ? { observerModel } : {}),
    asSigningKey,
  };
}
