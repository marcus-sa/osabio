import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { LoggerProvider, SimpleLogRecordProcessor, InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";

describe("telemetry/logger", () => {
  const exporter = new InMemoryLogRecordExporter();
  let originalProvider: ReturnType<typeof logs.getLoggerProvider>;

  beforeEach(() => {
    originalProvider = logs.getLoggerProvider();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(exporter)],
    });
    logs.setGlobalLoggerProvider(provider);
    exporter.getFinishedLogRecords().length = 0;
  });

  afterAll(() => {
    logs.setGlobalLoggerProvider(originalProvider);
  });

  test("log.info emits OTEL log record with INFO severity", async () => {
    const { log } = await import("../../app/src/server/telemetry/logger");

    log.info("server.started", "Server started on port 3000", { port: 3000 });

    const records = exporter.getFinishedLogRecords();
    expect(records.length).toBe(1);
    expect(records[0].severityNumber).toBe(SeverityNumber.INFO);
    expect(records[0].severityText).toBe("INFO");
    expect(records[0].body).toBe("Server started on port 3000");
    expect(records[0].attributes?.["event"]).toBe("server.started");
    expect(records[0].attributes?.["port"]).toBe(3000);
  });

  test("log.warn emits OTEL log record with WARN severity", async () => {
    const { log } = await import("../../app/src/server/telemetry/logger");

    log.warn("rate.limit", "Rate limit approaching");

    const records = exporter.getFinishedLogRecords();
    expect(records.length).toBe(1);
    expect(records[0].severityNumber).toBe(SeverityNumber.WARN);
    expect(records[0].severityText).toBe("WARN");
    expect(records[0].body).toBe("Rate limit approaching");
    expect(records[0].attributes?.["event"]).toBe("rate.limit");
  });

  test("log.error emits OTEL log record with ERROR severity and serialized error", async () => {
    const { log } = await import("../../app/src/server/telemetry/logger");

    const testError = new Error("connection refused");
    log.error("db.connect", "Database connection failed", testError, { host: "localhost" });

    const records = exporter.getFinishedLogRecords();
    expect(records.length).toBe(1);
    expect(records[0].severityNumber).toBe(SeverityNumber.ERROR);
    expect(records[0].severityText).toBe("ERROR");
    expect(records[0].body).toBe("Database connection failed");
    expect(records[0].attributes?.["event"]).toBe("db.connect");
    expect(records[0].attributes?.["host"]).toBe("localhost");
    expect(records[0].attributes?.["error.name"]).toBe("Error");
    expect(records[0].attributes?.["error.message"]).toBe("connection refused");
  });

  test("log.debug emits OTEL log record with DEBUG severity", async () => {
    const { log } = await import("../../app/src/server/telemetry/logger");

    log.debug("cache.hit", "Cache hit for key", { key: "user:123" });

    const records = exporter.getFinishedLogRecords();
    expect(records.length).toBe(1);
    expect(records[0].severityNumber).toBe(SeverityNumber.DEBUG);
    expect(records[0].severityText).toBe("DEBUG");
    expect(records[0].body).toBe("Cache hit for key");
    expect(records[0].attributes?.["event"]).toBe("cache.hit");
    expect(records[0].attributes?.["key"]).toBe("user:123");
  });
});
