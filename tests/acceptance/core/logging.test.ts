import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";

const getRuntime = setupAcceptanceSuite("logging");

const logFilePath = process.env.SMOKE_LOG_FILE;

describe("logging smoke", () => {
  it("sets and forwards request ids for health checks and client errors", async () => {
    const { baseUrl } = getRuntime();

    const generatedRequestId = await assertRequestIdGenerated(baseUrl);
    const forwardedRequestId = `smoke-${crypto.randomUUID()}`;
    await assertRequestIdForwarded(baseUrl, forwardedRequestId);
    const invalidRequestId = await assertRequestIdOnClientError(baseUrl);

    if (logFilePath && logFilePath.trim().length > 0) {
      await assertLogFileShape(logFilePath, [generatedRequestId, forwardedRequestId, invalidRequestId]);
    }
  }, 30_000);
});

async function assertRequestIdGenerated(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/healthz`);
  expect(response.ok).toBe(true);

  const requestId = response.headers.get("x-request-id");
  expect(typeof requestId).toBe("string");
  if (typeof requestId !== "string") {
    throw new Error("x-request-id missing on /healthz");
  }
  expect(requestId.length).toBeGreaterThan(0);

  const payload = (await response.json()) as { status: string };
  expect(payload.status).toBe("ok");

  return requestId;
}

async function assertRequestIdForwarded(baseUrl: string, requestId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/healthz`, {
    headers: {
      "x-request-id": requestId,
    },
  });

  expect(response.ok).toBe(true);
  expect(response.headers.get("x-request-id")).toBe(requestId);
}

async function assertRequestIdOnClientError(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/entities/search`);
  expect(response.status).toBe(400);

  const requestId = response.headers.get("x-request-id");
  expect(typeof requestId).toBe("string");
  if (typeof requestId !== "string") {
    throw new Error("x-request-id missing on 4xx response");
  }
  expect(requestId.length).toBeGreaterThan(0);

  const payload = (await response.json()) as { error: string };
  expect(typeof payload.error).toBe("string");
  expect(payload.error.length).toBeGreaterThan(0);

  return requestId;
}

async function assertLogFileShape(logPath: string, requestIds: string[]): Promise<void> {
  const file = Bun.file(logPath);
  const exists = await file.exists();
  expect(exists).toBe(true);

  const content = await file.text();
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThan(0);

  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(typeof parsed.timestamp).toBe("string");
    expect(typeof parsed.level).toBe("string");
    expect(typeof parsed.event).toBe("string");
    rows.push(parsed);
  }

  for (const requestId of requestIds) {
    const requestRows = rows.filter((row) => row.requestId === requestId);
    expect(requestRows.length).toBeGreaterThan(0);
    expect(requestRows.some((row) => row.event === "http.request.completed")).toBe(true);
  }
}
