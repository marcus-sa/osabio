import pino, { type Logger, type LevelWithSilent } from "pino";
import { getRequestContext } from "./request-context";

const runtimeEnv = process.env.NODE_ENV;
if (!runtimeEnv || runtimeEnv.trim().length === 0) {
  throw new Error("NODE_ENV is required");
}

const configuredLevel = process.env.LOG_LEVEL?.trim();
if (!configuredLevel || configuredLevel.length === 0) {
  throw new Error("LOG_LEVEL is required");
}
const logLevel = configuredLevel as LevelWithSilent;

export const logger = pino({
  level: logLevel,
  base: {
    service: "brain-server",
    env: runtimeEnv,
    runtime: "bun",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.headers['proxy-authorization']",
      "openRouterApiKey",
      "apiKey",
      "authorization",
      "cookie",
    ],
    remove: true,
  },
});

export function getRequestLogger(meta?: Record<string, unknown>): Logger {
  const context = getRequestContext();

  const requestMeta = context
    ? {
        requestId: context.requestId,
        method: context.method,
        route: context.route,
        path: context.path,
      }
    : {};

  if (meta) {
    return logger.child({
      ...requestMeta,
      ...meta,
    });
  }

  if (context) {
    return logger.child(requestMeta);
  }

  return logger;
}

export function serializeError(error: unknown, depth = 0): Record<string, unknown> | unknown {
  if (depth > 2) {
    return { message: "max depth reached" };
  }

  if (!(error instanceof Error)) {
    return error;
  }

  const candidate = error as Error & {
    cause?: unknown;
    statusCode?: unknown;
    url?: unknown;
    code?: unknown;
    isRetryable?: unknown;
    responseHeaders?: unknown;
    responseBody?: unknown;
    requestBodyValues?: unknown;
    data?: unknown;
  };

  const serialized: Record<string, unknown> = {
    name: candidate.name,
    message: candidate.message,
    stack: candidate.stack,
  };

  if (candidate.statusCode !== undefined) {
    serialized.statusCode = candidate.statusCode;
  }

  if (candidate.url !== undefined) {
    serialized.url = candidate.url;
  }

  if (candidate.code !== undefined) {
    serialized.code = candidate.code;
  }

  if (candidate.isRetryable !== undefined) {
    serialized.isRetryable = candidate.isRetryable;
  }

  const requestBodySummary = summarizeRequestBodyValues(candidate.requestBodyValues);
  if (requestBodySummary !== undefined) {
    serialized.requestBodySummary = requestBodySummary;
  }

  const responseHeaders = summarizeResponseHeaders(candidate.responseHeaders);
  if (responseHeaders !== undefined) {
    serialized.responseHeaders = responseHeaders;
  }

  const responseBodySummary = summarizeResponseBody(candidate.responseBody);
  if (responseBodySummary !== undefined) {
    serialized.responseBody = responseBodySummary;
    const providerError = extractProviderErrorDetails(responseBodySummary);
    if (providerError !== undefined) {
      serialized.providerError = providerError;
    }
  }

  if (candidate.data !== undefined) {
    serialized.data = serializeUnknown(candidate.data);
    if (serialized.providerError === undefined) {
      const providerError = extractProviderErrorDetails(candidate.data);
      if (providerError !== undefined) {
        serialized.providerError = providerError;
      }
    }
  }

  if (candidate.cause !== undefined) {
    serialized.cause = serializeError(candidate.cause, depth + 1);
  }

  return serialized;
}

function summarizeRequestBodyValues(requestBodyValues: unknown): Record<string, unknown> | undefined {
  if (!isRecord(requestBodyValues)) {
    return undefined;
  }

  const summary: Record<string, unknown> = {};

  if (typeof requestBodyValues.model === "string") {
    summary.model = requestBodyValues.model;
  }

  if (typeof requestBodyValues.max_tokens === "number") {
    summary.maxTokens = requestBodyValues.max_tokens;
  }

  if (typeof requestBodyValues.temperature === "number") {
    summary.temperature = requestBodyValues.temperature;
  }

  if (typeof requestBodyValues.top_p === "number") {
    summary.topP = requestBodyValues.top_p;
  }

  if (Array.isArray(requestBodyValues.messages)) {
    summary.messagesCount = requestBodyValues.messages.length;
    const roleCounts: Record<string, number> = {};
    for (const message of requestBodyValues.messages) {
      if (!isRecord(message) || typeof message.role !== "string") {
        continue;
      }
      roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
    }
    if (Object.keys(roleCounts).length > 0) {
      summary.messageRoles = roleCounts;
    }
  }

  if (Array.isArray(requestBodyValues.input)) {
    summary.inputCount = requestBodyValues.input.length;
  }

  if (Array.isArray(requestBodyValues.tools)) {
    summary.toolsCount = requestBodyValues.tools.length;
  }

  if (isRecord(requestBodyValues.response_format) && typeof requestBodyValues.response_format.type === "string") {
    summary.responseFormatType = requestBodyValues.response_format.type;
  }

  const keys = Object.keys(summary);
  if (keys.length === 0) {
    summary.keys = Object.keys(requestBodyValues).slice(0, 20);
  }

  return summary;
}

function summarizeResponseHeaders(responseHeaders: unknown): Record<string, string> | undefined {
  if (responseHeaders instanceof Headers) {
    return selectResponseHeaders(Object.fromEntries(responseHeaders.entries()));
  }

  if (isRecord(responseHeaders)) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        normalized[key] = String(value);
      }
    }
    return selectResponseHeaders(normalized);
  }

  return undefined;
}

function selectResponseHeaders(headers: Record<string, string>): Record<string, string> | undefined {
  const selected: Record<string, string> = {};
  const lowerMap = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    lowerMap.set(key.toLowerCase(), value);
  }

  const keys = [
    "content-type",
    "date",
    "server",
    "request-id",
    "x-request-id",
    "x-openrouter-request-id",
    "cf-ray",
  ];

  for (const key of keys) {
    const value = lowerMap.get(key);
    if (value !== undefined) {
      selected[key] = truncateString(value, 300);
    }
  }

  for (const [key, value] of lowerMap.entries()) {
    if (!key.startsWith("x-ratelimit")) {
      continue;
    }
    selected[key] = truncateString(value, 300);
  }

  return Object.keys(selected).length > 0 ? selected : undefined;
}

function summarizeResponseBody(responseBody: unknown): unknown {
  if (responseBody === undefined) {
    return undefined;
  }

  if (typeof responseBody === "string") {
    const trimmed = responseBody.trim();
    if (trimmed.length === 0) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return serializeUnknown(parsed);
    } catch {
      return truncateString(trimmed, 4000);
    }
  }

  return serializeUnknown(responseBody);
}

function extractProviderErrorDetails(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const errorObject = isRecord(payload.error) ? payload.error : payload;
  const details: Record<string, unknown> = {};
  const metadata = isRecord(errorObject.metadata) ? errorObject.metadata : undefined;

  if (typeof errorObject.message === "string") {
    details.message = truncateString(errorObject.message, 1000);
  }
  if (typeof errorObject.type === "string") {
    details.type = errorObject.type;
  }
  if (typeof errorObject.code === "string" || typeof errorObject.code === "number") {
    details.code = errorObject.code;
  }
  if (typeof errorObject.param === "string") {
    details.param = errorObject.param;
  }

  if (metadata) {
    if (typeof metadata.provider_name === "string") {
      details.providerName = metadata.provider_name;
    }
    if (typeof metadata.is_byok === "boolean") {
      details.isByok = metadata.is_byok;
    }

    const upstream = extractUpstreamProviderError(metadata.raw);
    if (upstream !== undefined) {
      details.upstream = upstream;
      if (details.message === "Provider returned error" && typeof upstream.message === "string") {
        details.message = upstream.message;
      }
      if (details.type === undefined && typeof upstream.type === "string") {
        details.type = upstream.type;
      }
      if (details.code === undefined && (typeof upstream.code === "string" || typeof upstream.code === "number")) {
        details.code = upstream.code;
      }
      if (details.param === undefined && typeof upstream.param === "string") {
        details.param = upstream.param;
      }
    }
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function extractUpstreamProviderError(rawMetadata: unknown): Record<string, unknown> | undefined {
  if (typeof rawMetadata !== "string") {
    return undefined;
  }

  const trimmed = rawMetadata.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return { raw: truncateString(trimmed, 2000) };
    }

    const errorObject = isRecord(parsed.error) ? parsed.error : parsed;
    const details: Record<string, unknown> = {};

    if (typeof errorObject.message === "string") {
      details.message = truncateString(errorObject.message, 1000);
    }
    if (typeof errorObject.type === "string") {
      details.type = errorObject.type;
    }
    if (typeof errorObject.code === "string" || typeof errorObject.code === "number") {
      details.code = errorObject.code;
    }
    if (typeof errorObject.param === "string") {
      details.param = errorObject.param;
    }

    return Object.keys(details).length > 0 ? details : { raw: truncateString(trimmed, 2000) };
  } catch {
    return { raw: truncateString(trimmed, 2000) };
  }
}

function serializeUnknown(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (depth > 3) {
    return "[max depth reached]";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return truncateString(value, 4000);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => serializeUnknown(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    return serializeError(value, depth + 1);
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value).slice(0, 30)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "user_id" || normalizedKey === "userid" || normalizedKey === "api_key" || normalizedKey === "apikey") {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = serializeUnknown(entryValue, depth + 1, seen);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…[truncated]`;
}
