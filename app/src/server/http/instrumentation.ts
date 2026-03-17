/**
 * HTTP request tracing — wide event instrumentation.
 *
 * Each request gets a single root span enriched throughout its lifecycle.
 * Handlers call trace.getActiveSpan()?.setAttribute() to attach business
 * context (workspace, user, conversation, entity counts, model info).
 *
 * At span end, one comprehensive event carries everything — replacing
 * scattered log.info("started")/log.info("completed") pairs.
 */

import { randomUUID } from "node:crypto";
import { trace, context, SpanStatusCode } from "@opentelemetry/api";
import { HttpError } from "./errors";
import { jsonError, withRequestIdHeader } from "./response";
import { httpDurationHistogram, httpRequestsCounter } from "../telemetry/metrics";

export type RouteRequest = Request & {
  params: Record<string, string>;
};

export type RouteHandler = (request: RouteRequest) => Response | Promise<Response>;

const tracer = trace.getTracer("brain-server");

function extractRequestId(request: Request): string {
  const headerValue = request.headers.get("x-request-id")?.trim();
  return headerValue && headerValue.length > 0 ? headerValue : randomUUID();
}

export function withTracing(route: string, method: string, handler: RouteHandler): RouteHandler {
  return async (request: RouteRequest) => {
    const startedAt = performance.now();
    const requestId = extractRequestId(request);
    const url = new URL(request.url);

    return tracer.startActiveSpan("brain.http.request", (span) => {
      // Base HTTP attributes — always present
      span.setAttribute("http.method", method);
      span.setAttribute("http.route", route);
      span.setAttribute("http.target", url.pathname);
      span.setAttribute("request.id", requestId);

      // Business context from URL params (available before handler runs)
      if (request.params?.workspaceId) {
        span.setAttribute("workspace.id", request.params.workspaceId);
      }
      if (request.params?.conversationId) {
        span.setAttribute("conversation.id", request.params.conversationId);
      }

      // Client identification
      const userAgent = request.headers.get("user-agent");
      if (userAgent) span.setAttribute("http.user_agent", userAgent);

      const contentLength = request.headers.get("content-length");
      if (contentLength) span.setAttribute("http.request.content_length", Number(contentLength));

      return context.with(trace.setSpan(context.active(), span), async () => {
        try {
          const response = await handler(request);
          const responseWithRequestId = withRequestIdHeader(response, requestId);
          const statusCode = responseWithRequestId.status;
          const durationMs = Number((performance.now() - startedAt).toFixed(2));

          span.setAttribute("http.status_code", statusCode);
          span.setAttribute("duration_ms", durationMs);
          span.setStatus({ code: statusCode >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
          span.end();

          const metricAttrs = { "http.method": method, "http.route": route, "http.status_code": statusCode };
          httpDurationHistogram.record(durationMs, metricAttrs);
          httpRequestsCounter.add(1, metricAttrs);

          return responseWithRequestId;
        } catch (error) {
          const durationMs = Number((performance.now() - startedAt).toFixed(2));
          const statusCode = error instanceof HttpError ? error.status : 500;

          span.setAttribute("http.status_code", statusCode);
          span.setAttribute("duration_ms", durationMs);
          span.setAttribute("error", true);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : "unknown error",
          });
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.end();

          const metricAttrs = { "http.method": method, "http.route": route, "http.status_code": statusCode };
          httpDurationHistogram.record(durationMs, metricAttrs);
          httpRequestsCounter.add(1, metricAttrs);

          if (error instanceof HttpError) {
            return withRequestIdHeader(jsonError(error.message, error.status), requestId);
          }
          return withRequestIdHeader(jsonError("internal server error", 500), requestId);
        }
      });
    });
  };
}
