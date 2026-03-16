/**
 * OTEL-backed structured logger for the Brain server.
 *
 * Emits log records via the OTEL Logs API. When no LoggerProvider is
 * registered (pre-init), falls back to console.* so early boot messages
 * are not lost.
 *
 * API mirrors the existing logInfo/logWarn/logError/logDebug shape from
 * http/observability.ts for straightforward migration.
 */

import { logs, SeverityNumber } from "@opentelemetry/api-logs";

// ---------------------------------------------------------------------------
// serializeError — moved from logging.ts
// ---------------------------------------------------------------------------

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

  if (candidate.statusCode !== undefined) serialized.statusCode = candidate.statusCode;
  if (candidate.url !== undefined) serialized.url = candidate.url;
  if (candidate.code !== undefined) serialized.code = candidate.code;
  if (candidate.isRetryable !== undefined) serialized.isRetryable = candidate.isRetryable;
  if (candidate.cause !== undefined) serialized.cause = serializeError(candidate.cause, depth + 1);

  return serialized;
}

// ---------------------------------------------------------------------------
// Console fallback for pre-init
// ---------------------------------------------------------------------------

function getConsoleFn(severity: string): (...args: unknown[]) => void {
  switch (severity) {
    case "DEBUG": return console.debug;
    case "INFO": return console.log;
    case "WARN": return console.warn;
    case "ERROR": return console.error;
    default: return console.log;
  }
}

export function logToConsole(
  severity: string,
  event: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const fn = getConsoleFn(severity);
  fn(`[${severity}] ${event}: ${message}`, meta ?? "");
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

interface SeverityInfo {
  readonly number: SeverityNumber;
  readonly text: string;
}

const SEVERITY_DEBUG: SeverityInfo = { number: SeverityNumber.DEBUG, text: "DEBUG" };
const SEVERITY_INFO: SeverityInfo = { number: SeverityNumber.INFO, text: "INFO" };
const SEVERITY_WARN: SeverityInfo = { number: SeverityNumber.WARN, text: "WARN" };
const SEVERITY_ERROR: SeverityInfo = { number: SeverityNumber.ERROR, text: "ERROR" };

// ---------------------------------------------------------------------------
// Core emit function
// ---------------------------------------------------------------------------

function emitLogRecord(
  severity: SeverityInfo,
  event: string,
  message: string,
  meta?: Record<string, unknown>,
  error?: unknown,
): void {
  const logger = logs.getLogger("brain-server");

  const attributes: Record<string, unknown> = { event, ...meta };

  if (error !== undefined) {
    const serialized = serializeError(error);
    if (typeof serialized === "object" && serialized !== undefined) {
      const errorRecord = serialized as Record<string, unknown>;
      if (errorRecord.name !== undefined) attributes["error.name"] = errorRecord.name;
      if (errorRecord.message !== undefined) attributes["error.message"] = errorRecord.message;
      if (errorRecord.stack !== undefined) attributes["error.stack"] = errorRecord.stack;
    }
  }

  logger.emit({
    severityNumber: severity.number,
    severityText: severity.text,
    body: message,
    attributes,
  });
}

// ---------------------------------------------------------------------------
// Public API — matches existing logInfo/logWarn/logError/logDebug shape
// ---------------------------------------------------------------------------

export const log = {
  debug(event: string, message: string, meta?: Record<string, unknown>): void {
    emitLogRecord(SEVERITY_DEBUG, event, message, meta);
  },

  info(event: string, message: string, meta?: Record<string, unknown>): void {
    emitLogRecord(SEVERITY_INFO, event, message, meta);
  },

  warn(event: string, message: string, meta?: Record<string, unknown>): void {
    emitLogRecord(SEVERITY_WARN, event, message, meta);
  },

  error(event: string, message: string, error: unknown, meta?: Record<string, unknown>): void {
    emitLogRecord(SEVERITY_ERROR, event, message, meta, error);
  },
};
