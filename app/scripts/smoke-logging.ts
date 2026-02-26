const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const logFilePath = process.env.SMOKE_LOG_FILE;

await run();

export {};

async function run(): Promise<void> {
  console.log(`Running logging smoke against ${baseUrl}`);

  const generatedRequestId = await assertRequestIdGenerated();
  const forwardedRequestId = `smoke-${crypto.randomUUID()}`;
  await assertRequestIdForwarded(forwardedRequestId);
  const invalidRequestId = await assertRequestIdOnClientError();

  if (logFilePath && logFilePath.trim().length > 0) {
    await assertLogFileShape(logFilePath, [generatedRequestId, forwardedRequestId, invalidRequestId]);
    console.log(`log shape check passed (${logFilePath})`);
  } else {
    console.log("log shape check skipped (set SMOKE_LOG_FILE to validate JSON log lines)");
  }

  console.log("Logging smoke passed");
}

async function assertRequestIdGenerated(): Promise<string> {
  const response = await fetch(`${baseUrl}/healthz`);
  assert(response.ok, `/healthz failed with status ${response.status}`);

  const requestId = response.headers.get("x-request-id");
  assert(typeof requestId === "string" && requestId.length > 0, "x-request-id missing on /healthz");

  const payload = (await response.json()) as { status: string };
  assert(payload.status === "ok", "/healthz body status was not ok");

  return requestId;
}

async function assertRequestIdForwarded(requestId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/healthz`, {
    headers: {
      "x-request-id": requestId,
    },
  });

  assert(response.ok, `/healthz with forwarded request id failed with status ${response.status}`);
  assert(response.headers.get("x-request-id") === requestId, "response did not preserve forwarded x-request-id");
}

async function assertRequestIdOnClientError(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/entities/search`);
  assert(response.status === 400, `expected 400 from /api/entities/search, got ${response.status}`);

  const requestId = response.headers.get("x-request-id");
  assert(typeof requestId === "string" && requestId.length > 0, "x-request-id missing on 4xx response");

  const payload = (await response.json()) as { error: string };
  assert(typeof payload.error === "string" && payload.error.length > 0, "error payload missing on 4xx response");

  return requestId;
}

async function assertLogFileShape(logPath: string, requestIds: string[]): Promise<void> {
  const file = Bun.file(logPath);
  const exists = await file.exists();
  assert(exists, `log file does not exist: ${logPath}`);

  const content = await file.text();
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert(lines.length > 0, "log file was empty");

  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`log line was not valid JSON: ${line}`, { cause: error });
    }

    assert(parsed && typeof parsed === "object", "log line did not parse into an object");
    const row = parsed as Record<string, unknown>;
    assert(typeof row.timestamp === "string", "log row missing timestamp");
    assert(typeof row.level === "string", "log row missing level");
    assert(typeof row.event === "string", "log row missing event");
    rows.push(row);
  }

  for (const requestId of requestIds) {
    const requestRows = rows.filter((row) => row.requestId === requestId);
    assert(requestRows.length > 0, `no log rows found for requestId ${requestId}`);
    assert(
      requestRows.some((row) => row.event === "http.request.completed"),
      `missing http.request.completed for requestId ${requestId}`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
