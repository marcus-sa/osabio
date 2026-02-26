import pino, { type Logger, type LevelWithSilent } from "pino";
import { getRequestContext } from "./request-context";

const runtimeEnv = Bun.env.NODE_ENV ?? "development";
const isProduction = runtimeEnv === "production";

const configuredLevel = Bun.env.LOG_LEVEL?.trim();
const logLevel = (configuredLevel && configuredLevel.length > 0
  ? configuredLevel
  : isProduction
    ? "info"
    : "debug") as LevelWithSilent;

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

  if (candidate.cause !== undefined) {
    serialized.cause = serializeError(candidate.cause, depth + 1);
  }

  return serialized;
}
