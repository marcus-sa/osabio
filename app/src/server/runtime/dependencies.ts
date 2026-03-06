import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import { createAuth, type Auth } from "../auth/config";

export async function createRuntimeDependencies(config: ServerConfig): Promise<{
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  architectModel: any;
  embeddingModel: any;
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
  const chatAgentModel = openrouter(config.chatAgentModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  });
  const extractionModel = openrouter(config.extractionModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  });
  const pmAgentModel = openrouter(config.pmAgentModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  });
  const analyticsAgentModel = openrouter(config.analyticsAgentModelId, {
    plugins: [{ id: "response-healing" }],
  });
  const architectModel = openrouter(config.architectModelId, {
    plugins: [{ id: "response-healing" }],
    ...(config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
  });
  const embeddingModel = openrouter.textEmbeddingModel(config.embeddingModelId);

  const auth = createAuth(surreal, {
    betterAuthSecret: config.betterAuthSecret,
    betterAuthUrl: config.betterAuthUrl,
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
  });

  return {
    surreal,
    analyticsSurreal,
    auth,
    chatAgentModel,
    extractionModel,
    pmAgentModel,
    analyticsAgentModel,
    architectModel,
    embeddingModel,
  };
}
