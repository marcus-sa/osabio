/**
 * Typed function ID constants for the brain.* OpenTelemetry taxonomy.
 *
 * Each constant identifies a distinct instrumented function boundary
 * (LLM call, pipeline, or agent invocation) for tracing, metrics, and logs.
 */

export const FUNCTION_IDS = {
  CHAT_AGENT: "brain.chat-agent",
  EXTRACTION: "brain.extraction",
  PM_AGENT: "brain.pm-agent",
  ANALYTICS_AGENT: "brain.analytics-agent",
  OBSERVER_VERIFICATION: "brain.observer.verification",
  OBSERVER_SYNTHESIS: "brain.observer.synthesis",
  OBSERVER_LEARNING_DIAGNOSIS: "brain.observer.learning-diagnosis",
  BEHAVIOR_SCORER: "brain.behavior-scorer",
  ONBOARDING: "brain.onboarding",
  INTENT_AUTHORIZER: "brain.intent.authorizer",
  MCP_CONTEXT: "brain.mcp.context",
  DESCRIPTIONS: "brain.descriptions",
  ORCHESTRATOR: "brain.orchestrator",
  PROXY_CONTEXT_INJECTION: "brain.proxy.context-injection",
  PROXY_CONTRADICTION_DETECTION: "brain.proxy.contradiction-detection",
} as const;

/** Union type of all valid function IDs in the brain.* taxonomy. */
export type FunctionId = (typeof FUNCTION_IDS)[keyof typeof FUNCTION_IDS];
