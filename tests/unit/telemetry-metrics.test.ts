import { describe, test, expect } from "bun:test";

describe("telemetry/metrics", () => {
  test("exports seven metric instruments with correct names", async () => {
    const m = await import("../../app/src/server/telemetry/metrics");

    // Histograms
    expect(m.llmDurationHistogram).toBeDefined();
    expect(m.httpDurationHistogram).toBeDefined();

    // Counters
    expect(m.llmPromptTokensCounter).toBeDefined();
    expect(m.llmCompletionTokensCounter).toBeDefined();
    expect(m.llmErrorsCounter).toBeDefined();
    expect(m.httpRequestsCounter).toBeDefined();
    expect(m.extractionEntitiesCounter).toBeDefined();
  });

  test("metric instruments have record/add methods", async () => {
    const m = await import("../../app/src/server/telemetry/metrics");

    // Histograms have record method
    expect(typeof m.llmDurationHistogram.record).toBe("function");
    expect(typeof m.httpDurationHistogram.record).toBe("function");

    // Counters have add method
    expect(typeof m.llmPromptTokensCounter.add).toBe("function");
    expect(typeof m.llmCompletionTokensCounter.add).toBe("function");
    expect(typeof m.llmErrorsCounter.add).toBe("function");
    expect(typeof m.httpRequestsCounter.add).toBe("function");
    expect(typeof m.extractionEntitiesCounter.add).toBe("function");
  });

  test("metric instruments can be called without error (no-op meter)", async () => {
    const m = await import("../../app/src/server/telemetry/metrics");

    // Should not throw even with no MeterProvider configured
    expect(() => m.llmDurationHistogram.record(150, { model: "gpt-4" })).not.toThrow();
    expect(() => m.httpDurationHistogram.record(42, { method: "GET", route: "/api/chat" })).not.toThrow();
    expect(() => m.llmPromptTokensCounter.add(500, { model: "gpt-4" })).not.toThrow();
    expect(() => m.llmCompletionTokensCounter.add(200, { model: "gpt-4" })).not.toThrow();
    expect(() => m.llmErrorsCounter.add(1, { model: "gpt-4", error_type: "timeout" })).not.toThrow();
    expect(() => m.httpRequestsCounter.add(1, { method: "POST", status: "200" })).not.toThrow();
    expect(() => m.extractionEntitiesCounter.add(3, { entity_type: "task" })).not.toThrow();
  });
});
