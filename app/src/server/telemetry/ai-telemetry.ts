/**
 * AI SDK telemetry configuration and metric recording.
 *
 * Provides createTelemetryConfig for experimental_telemetry on all AI SDK calls,
 * and recordLlmMetrics/recordLlmError for manual metric recording alongside
 * the automatic OTEL spans emitted by the AI SDK.
 */

import type { LanguageModelUsage } from "ai";
import type { FunctionId } from "./function-ids";
import {
  llmDurationHistogram,
  llmPromptTokensCounter,
  llmCompletionTokensCounter,
  llmErrorsCounter,
} from "./metrics";

/** Shape of AI SDK experimental_telemetry config object. */
export type AiTelemetryConfig = {
  isEnabled: true;
  functionId: FunctionId;
  metadata: { service: string };
};

/** Token usage from AI SDK response. */
export type TokenUsage = LanguageModelUsage;

/**
 * Creates the experimental_telemetry config to spread into AI SDK calls.
 * The AI SDK uses this to emit OTEL spans with model ID, tokens, and latency.
 */
export function createTelemetryConfig(functionId: FunctionId): AiTelemetryConfig {
  return {
    isEnabled: true,
    functionId,
    metadata: { service: "osabio-server" },
  };
}

/**
 * Records LLM duration histogram and token counters for a completed call.
 * Safe to call even when no MeterProvider is registered (instruments are no-ops).
 */
export function recordLlmMetrics(
  functionId: FunctionId,
  usage: TokenUsage,
  durationMs: number,
): void {
  const attributes = { functionId };

  llmDurationHistogram.record(durationMs, attributes);

  if (usage.inputTokens !== undefined && usage.inputTokens > 0) {
    llmPromptTokensCounter.add(usage.inputTokens, attributes);
  }

  if (usage.outputTokens !== undefined && usage.outputTokens > 0) {
    llmCompletionTokensCounter.add(usage.outputTokens, attributes);
  }
}

/**
 * Increments the LLM error counter for a failed call.
 */
export function recordLlmError(functionId: FunctionId, errorType: string): void {
  llmErrorsCounter.add(1, { functionId, errorType });
}
