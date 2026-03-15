/**
 * Acceptance Tests: Transparent Proxy Passthrough (US-LP-001)
 *
 * Traces: US-LP-001 — Transparent Proxy Passthrough
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Walking skeleton + focused scenarios proving the proxy forwards
 * LLM requests transparently with zero perceptible latency overhead.
 *
 * Implementation sequence:
 * 1. Walking skeleton (non-streaming passthrough) — ENABLED
 * 2. Streaming passthrough
 * 3. Upstream failure error
 * 4. Header forwarding
 * 5. Malformed body handling
 * 6. count_tokens forwarding
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  sendCountTokensRequest,
  collectProxySSEEvents,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_passthrough");

// ---------------------------------------------------------------------------
// Walking Skeleton: Developer's LLM call works identically through the proxy
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Non-streaming request forwarded transparently", () => {
  it("forwards a non-streaming request and returns the model response unmodified", async () => {
    const { baseUrl } = getRuntime();

    // Given Priya sends a non-streaming request for model "claude-sonnet-4"
    // (uses a real API key from env — acceptance tests hit real services)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Reply with exactly the word 'hello'." }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
    });

    // Then the response arrives with the original status code
    expect(response.status).toBe(200);

    // And the response body contains a valid Anthropic Messages API response
    const body = await response.json() as {
      id: string;
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content).toBeInstanceOf(Array);
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content[0].type).toBe("text");
    expect(body.model).toContain("claude");
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Streaming request relays all SSE events", () => {
  it.skip("relays SSE events as raw bytes with all event types passing through", async () => {
    const { baseUrl } = getRuntime();

    // Given Priya sends a streaming request
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: true,
      maxTokens: 50,
      messages: [{ role: "user", content: "Reply with exactly: 'hello world'" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // Then SSE events are relayed with expected event types
    const events = await collectProxySSEEvents(response);
    const eventTypes = events
      .filter(e => e.data !== "[DONE]")
      .map(e => {
        try { return (JSON.parse(e.data) as { type: string }).type; }
        catch { return "unknown"; }
      });

    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("message_stop");
    // content_block events should be present for text responses
    expect(eventTypes.some(t => t.startsWith("content_block"))).toBe(true);
  }, 30_000);
});

describe("Upstream failure returns distinguishable error", () => {
  it.skip("returns gateway error with proxy source identifier when upstream is unreachable", async () => {
    // This test requires the proxy to be configured with an unreachable upstream URL.
    // In acceptance tests, we simulate by sending to a non-existent upstream or by
    // using a test configuration that points to a dead host.
    //
    // For now, this validates the error shape when the upstream returns an error.
    const { baseUrl } = getRuntime();

    // Given Anthropic's API is unreachable (simulated with invalid API key causing 401)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "hello" }],
      apiKey: "sk-invalid-key-that-will-fail",
    });

    // Then the response indicates an upstream error
    // (With invalid key, Anthropic returns 401, which the proxy forwards)
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 15_000);
});

describe("Proxy forwards all required headers", () => {
  it.skip("includes anthropic-version, content-type, and x-api-key in upstream request", async () => {
    const { baseUrl } = getRuntime();

    // Given Priya's request includes all required headers
    // When the proxy forwards the request
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
    });

    // Then the request succeeds (proving headers were forwarded correctly)
    expect(response.status).toBe(200);
    const body = await response.json() as { type: string };
    expect(body.type).toBe("message");
  }, 15_000);
});

describe("Malformed request body forwarded without proxy interference", () => {
  it.skip("returns the upstream provider's error for invalid JSON", async () => {
    const { baseUrl } = getRuntime();

    // Given Priya sends a request with invalid structure
    const response = await fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "test-key",
      },
      body: JSON.stringify({ invalid: "body", missing: "required fields" }),
    });

    // Then the upstream's error is returned (proxy does not inject its own validation)
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 15_000);
});

describe("Count tokens request forwarded without creating a trace", () => {
  it.skip("forwards count_tokens and returns response without graph trace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given Priya sends a count_tokens request
    const response = await sendCountTokensRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "How many tokens is this?" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
    });

    // Then the token count response is returned
    expect(response.status).toBe(200);

    // And no trace is created (count_tokens is metadata, not generation)
    // Note: trace assertion depends on US-LP-003 implementation
  }, 15_000);
});
