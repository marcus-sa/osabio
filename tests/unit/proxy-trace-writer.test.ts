import { describe, expect, it, mock } from "bun:test";
import type { RecordId } from "surrealdb";
import { captureTrace } from "../../app/src/server/proxy/trace-writer";

describe("captureTrace", () => {
  it("writes identity to trace.actor (not trace.identity)", async () => {
    let traceContent: Record<string, unknown> | undefined;

    const query = mock(async (sql: string, vars?: Record<string, unknown>) => {
      if (sql.includes("CREATE $trace CONTENT $content;")) {
        traceContent = vars?.content as Record<string, unknown>;
      }
      return [];
    });

    const surreal = { query } as unknown as import("surrealdb").Surreal;

    await captureTrace(
      {
        model: "claude-sonnet-4",
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        latencyMs: 125,
        identityId: "identity-123",
      },
      { surreal },
    );

    expect(traceContent).toBeDefined();
    expect(traceContent?.identity).toBeUndefined();

    const actor = traceContent?.actor as RecordId<"identity", string> | undefined;
    expect(actor).toBeDefined();
    expect(actor?.table.name).toBe("identity");
    expect(actor?.id as string).toBe("identity-123");
  });
});
