/**
 * Typed function ID constants for the osabio.* OpenTelemetry taxonomy.
 *
 * Each constant identifies a distinct instrumented function boundary
 * (LLM call, pipeline, or agent invocation) for tracing, metrics, and logs.
 */

export const FUNCTION_IDS = {
  CHAT_AGENT: "osabio.chat-agent",
  EXTRACTION: "osabio.extraction",
  PM_AGENT: "osabio.pm-agent",
  ANALYTICS_AGENT: "osabio.analytics-agent",
  OBSERVER_VERIFICATION: "osabio.observer.verification",
  OBSERVER_SYNTHESIS: "osabio.observer.synthesis",
  OBSERVER_LEARNING_DIAGNOSIS: "osabio.observer.learning-diagnosis",
  BEHAVIOR_SCORER: "osabio.behavior-scorer",
  ONBOARDING: "osabio.onboarding",
  INTENT_AUTHORIZER: "osabio.intent.authorizer",
  MCP_CONTEXT: "osabio.mcp.context",
  DESCRIPTIONS: "osabio.descriptions",
  ORCHESTRATOR: "osabio.orchestrator",
  PROXY_CONTEXT_INJECTION: "osabio.proxy.context-injection",
  PROXY_CONTRADICTION_DETECTION: "osabio.proxy.contradiction-detection",
} as const;

/** Union type of all valid function IDs in the osabio.* taxonomy. */
export type FunctionId = (typeof FUNCTION_IDS)[keyof typeof FUNCTION_IDS];
