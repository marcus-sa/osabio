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

const meter = metrics.getMeter("osabio-server");

// ---------------------------------------------------------------------------
// LLM instruments
// ---------------------------------------------------------------------------

/** LLM call latency in milliseconds. */
export const llmDurationHistogram = meter.createHistogram("osabio.llm.duration", {
  description: "LLM call latency",
  unit: "ms",
});

/** Prompt token usage counter. */
export const llmPromptTokensCounter = meter.createCounter("osabio.llm.prompt_tokens", {
  description: "Prompt token usage",
});

/** Completion token usage counter. */
export const llmCompletionTokensCounter = meter.createCounter("osabio.llm.completion_tokens", {
  description: "Completion token usage",
});

/** LLM error count. */
export const llmErrorsCounter = meter.createCounter("osabio.llm.errors", {
  description: "LLM error count",
});

// ---------------------------------------------------------------------------
// HTTP instruments
// ---------------------------------------------------------------------------

/** HTTP request latency in milliseconds. */
export const httpDurationHistogram = meter.createHistogram("osabio.http.duration", {
  description: "HTTP request latency",
  unit: "ms",
});

/** HTTP request count. */
export const httpRequestsCounter = meter.createCounter("osabio.http.requests", {
  description: "HTTP request count",
});

// ---------------------------------------------------------------------------
// Extraction instruments
// ---------------------------------------------------------------------------

/** Extracted entity count. */
export const extractionEntitiesCounter = meter.createCounter("osabio.extraction.entities", {
  description: "Extracted entity count",
});
