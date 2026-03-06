import type { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import type { SseRegistry } from "../streaming/sse-registry";
import type { Auth } from "../auth/config";

export type ServerDependencies = {
  config: ServerConfig;
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  architectModel: any;
  embeddingModel: any;
  sse: SseRegistry;
};
