/**
 * OTEL metric instruments for the Brain server.
 *
 * Uses the OTEL Metrics API global meter. When no MeterProvider is
 * registered (pre-init), all instruments are no-ops — safe to call
 * at any point in the server lifecycle.
 *
 * Seven instruments covering LLM, HTTP, and extraction domains.
 */

import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("brain-server");

// ---------------------------------------------------------------------------
// LLM instruments
// ---------------------------------------------------------------------------

/** LLM call latency in milliseconds. */
export const llmDurationHistogram = meter.createHistogram("brain.llm.duration", {
  description: "LLM call latency",
  unit: "ms",
});

/** Prompt token usage counter. */
export const llmPromptTokensCounter = meter.createCounter("brain.llm.prompt_tokens", {
  description: "Prompt token usage",
});

/** Completion token usage counter. */
export const llmCompletionTokensCounter = meter.createCounter("brain.llm.completion_tokens", {
  description: "Completion token usage",
});

/** LLM error count. */
export const llmErrorsCounter = meter.createCounter("brain.llm.errors", {
  description: "LLM error count",
});

// ---------------------------------------------------------------------------
// HTTP instruments
// ---------------------------------------------------------------------------

/** HTTP request latency in milliseconds. */
export const httpDurationHistogram = meter.createHistogram("brain.http.duration", {
  description: "HTTP request latency",
  unit: "ms",
});

/** HTTP request count. */
export const httpRequestsCounter = meter.createCounter("brain.http.requests", {
  description: "HTTP request count",
});

// ---------------------------------------------------------------------------
// Extraction instruments
// ---------------------------------------------------------------------------

/** Extracted entity count. */
export const extractionEntitiesCounter = meter.createCounter("brain.extraction.entities", {
  description: "Extracted entity count",
});
