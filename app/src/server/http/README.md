# HTTP

Cross-cutting HTTP concerns — error handling, structured logging, response formatting, and request parsing shared by all route handlers.

## The Problem

Every route handler needs the same boilerplate: generate a request ID, log the request, catch exceptions, format responses with CORS headers, parse request bodies. Without a shared layer, each handler would duplicate this logic, leading to inconsistent error formats, missing request IDs, and silent failures.

## What It Does

- **Request lifecycle wrapper**: `withRequestLogging()` wraps every handler with request ID generation, timing, and error boundary
- **Structured logging**: `logInfo/logWarn/logError/logDebug()` with event name, message, and typed context objects
- **Response builders**: `jsonResponse()` and `jsonError()` with consistent CORS headers and status codes
- **Error types**: `HttpError` class with predefined status codes (400, 401, 403, 404, 409, 500)
- **Request parsing**: Form data and JSON body parsing with error handling

## Key Concepts

| Term | Definition |
|------|------------|
| **Request Context** | Async-local storage carrying request ID for correlated logging across async boundaries |
| **Route Handler** | `(request: Request) => Promise<Response>` with `params` extension for URL parameters |
| **Error Boundary** | Top-level try/catch in `withRequestLogging` that catches all exceptions and returns structured error responses |
| **Request ID** | UUID extracted from `x-request-id` header or generated fresh — attached to all logs and response headers |

## How It Works

1. Request arrives at a route
2. `withRequestLogging()` wrapper:
   - Extracts or generates request ID from headers
   - Logs `request.received` with method, path, timing
   - Runs handler inside `runWithRequestContext()` for async context tracking
   - On success: logs `request.completed` with elapsed time, adds `x-request-id` header
   - On failure: logs `request.failed`, returns `jsonError()` response
3. Handler uses `jsonResponse()` for success, throws `HttpError` for known errors
4. CORS headers automatically included on all responses

## Where It Fits

```text
Incoming Request
  |
  v
withRequestLogging() (this module)
  |
  +---> Generate/extract request ID
  +---> Log request.received
  +---> runWithRequestContext()
  |       |
  |       v
  |     Route Handler
  |       +-> jsonResponse() for success
  |       +-> throw HttpError for failures
  |       +-> parseJsonBody() for input
  |       |
  |       v
  +---> Log request.completed / request.failed
  +---> Add x-request-id header
  |
  v
Response (with CORS headers)
```

**Consumes**: Raw HTTP requests
**Produces**: Structured responses, correlated logs, request context

## File Structure

```text
http/
  errors.ts          # HttpError class with typed status codes (400, 401, 403, 404, 409, 500)
  observability.ts   # Structured logging: logInfo, logWarn, logError, logDebug, elapsedMs
  parsing.ts         # Form data + JSON body parsing with error handling
  request-logging.ts # withRequestLogging() wrapper, request context, RouteHandler type
  response.ts        # jsonResponse(), jsonError(), withRequestIdHeader(), CORS headers
```
