/**
 * HTTP request tracing wrapper using OpenTelemetry.
 *
 * Replaces withRequestLogging with OTEL-native instrumentation:
 * - Root span "brain.http.request" with method/route/status_code attributes
 * - x-request-id response header (preserved from incoming or generated)
 * - Error responses set span status ERROR and record exception
 * - httpDuration and httpRequests metrics recorded per request
 *
 * Same signature as withRequestLogging for mechanical replacement.
 */

import { randomUUID } from "node:crypto";
import { trace, context, SpanStatusCode } from "@opentelemetry/api";
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

function recordMetrics(
  durationMs: number,
  method: string,
  route: string,
  statusCode: number,
): void {
  const attributes = {
    "http.method": method,
    "http.route": route,
    "http.status_code": statusCode,
  };
  httpDurationHistogram.record(durationMs, attributes);
  httpRequestsCounter.add(1, attributes);
}

export function withTracing(route: string, method: string, handler: RouteHandler): RouteHandler {
  return async (request: RouteRequest) => {
    const startedAt = performance.now();
    const requestId = extractRequestId(request);
    const path = new URL(request.url).pathname;

    return tracer.startActiveSpan("brain.http.request", (span) => {
      span.setAttribute("http.method", method);
      span.setAttribute("http.route", route);
      span.setAttribute("http.target", path);
      span.setAttribute("requestId", requestId);

      return context.with(trace.setSpan(context.active(), span), async () => {
        try {
          const response = await handler(request);
          const responseWithRequestId = withRequestIdHeader(response, requestId);
          const statusCode = responseWithRequestId.status;

          span.setAttribute("http.status_code", statusCode);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          const durationMs = performance.now() - startedAt;
          recordMetrics(durationMs, method, route, statusCode);

          return responseWithRequestId;
        } catch (error) {
          span.setAttribute("http.status_code", 500);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : "unknown error" });
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.end();

          const durationMs = performance.now() - startedAt;
          recordMetrics(durationMs, method, route, 500);

          const fallback = jsonError("internal server error", 500);
          return withRequestIdHeader(fallback, requestId);
        }
      });
    });
  };
}
