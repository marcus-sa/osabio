import type { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import type { SseRegistry } from "../streaming/sse-registry";

export type ServerDependencies = {
  config: ServerConfig;
  surreal: Surreal;
  analyticsSurreal: Surreal;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  embeddingModel: any;
  sse: SseRegistry;
};
