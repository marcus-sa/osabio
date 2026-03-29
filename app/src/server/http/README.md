# HTTP

Cross-cutting HTTP concerns — error handling, request tracing, response formatting, and request parsing shared by all route handlers.

## The Problem

Every route handler needs the same boilerplate: generate a request ID, trace the request, catch exceptions, format responses with CORS headers, parse request bodies. Without a shared layer, each handler would duplicate this logic, leading to inconsistent error formats, missing request IDs, and silent failures.

## What It Does

- **Request tracing wrapper**: `withTracing()` wraps every handler with OTEL spans, request ID generation, metrics recording, and error boundary
- **Structured logging**: `log.info/warn/error/debug()` via OTEL Logs API (from `telemetry/logger.ts`)
- **Response builders**: `jsonResponse()` and `jsonError()` with consistent CORS headers and status codes
- **Error types**: `HttpError` class with predefined status codes (400, 401, 403, 404, 409, 500)
- **Request parsing**: Form data and JSON body parsing with error handling
- **Utilities**: `elapsedMs()` for timing, `userFacingError()` for safe error messages

## Key Concepts

| Term | Definition |
|------|------------|
| **OTEL Context** | OpenTelemetry context propagation carrying trace/span IDs across async boundaries |
| **Route Handler** | `(request: Request) => Promise<Response>` with `params` extension for URL parameters |
| **Error Boundary** | Top-level try/catch in `withTracing` that catches all exceptions and returns structured error responses |
| **Request ID** | UUID extracted from `x-request-id` header or generated fresh — attached to span attributes and response headers |

## How It Works

1. Request arrives at a route
2. `withTracing()` wrapper:
   - Extracts or generates request ID from headers
   - Creates root OTEL span `osabio.http.request` with method, route, path, requestId attributes
   - Runs handler within OTEL context (`context.with()`)
   - On success: sets `http.status_code` on span, records `httpDuration` histogram and `httpRequests` counter, adds `x-request-id` header
   - On failure: sets span status to ERROR, calls `span.recordException()`, records metrics with error status, returns `jsonError()` response
3. Handler uses `jsonResponse()` for success, throws `HttpError` for known errors
4. CORS headers automatically included on all responses

## Where It Fits

```text
Incoming Request
  |
  v
withTracing() (instrumentation.ts)
  |
  +---> Generate/extract request ID
  +---> Start OTEL span (osabio.http.request)
  +---> context.with(span)
  |       |
  |       v
  |     Route Handler
  |       +-> jsonResponse() for success
  |       +-> throw HttpError for failures
  |       +-> parseJsonBody() for input
  |       +-> log.info/error() inherits trace_id
  |       |
  |       v
  +---> Record httpDuration + httpRequests metrics
  +---> Set span status + status_code attribute
  +---> Add x-request-id header
  |
  v
Response (with CORS headers)
```

**Consumes**: Raw HTTP requests
**Produces**: Structured responses, OTEL spans/metrics, request context

## File Structure

```text
http/
  errors.ts          # HttpError class with typed status codes (400, 401, 403, 404, 409, 500)
  instrumentation.ts # withTracing() wrapper, RouteHandler type, OTEL span creation
  observability.ts   # Utilities: elapsedMs, userFacingError
  parsing.ts         # Form data + JSON body parsing with error handling
  response.ts        # jsonResponse(), jsonError(), withRequestIdHeader(), CORS headers
```
