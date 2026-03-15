import { logInfo, logError, elapsedMs } from "../http/observability";
import { jsonError } from "../http/response";

const ANTHROPIC_API_URL = "https://api.anthropic.com";

const FORWARDED_HEADERS = [
  "anthropic-version",
  "anthropic-beta",
  "content-type",
] as const;

export function createAnthropicProxyHandler(): (request: Request) => Promise<Response> {
  return (request: Request) => proxyToAnthropic(request);
}

async function proxyToAnthropic(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/proxy\/llm\/anthropic/, "");
  const upstreamUrl = `${ANTHROPIC_API_URL}${upstreamPath}`;

  // Forward auth and protocol headers from the client
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Forward client's API key — Claude Code sends its own
  const xApiKey = request.headers.get("x-api-key");
  const authHeader = request.headers.get("authorization");
  if (xApiKey) headers.set("x-api-key", xApiKey);
  if (authHeader) headers.set("authorization", authHeader);

  const body = await request.text();
  let parsed: { model?: string; stream?: boolean; max_tokens?: number; metadata?: { user_id?: string } } | undefined;
  try {
    parsed = JSON.parse(body);
  } catch {
    // not JSON — forward as-is
  }

  const isStreaming = parsed?.stream === true;
  const identity = parseMetadataUserId(parsed?.metadata?.user_id);

  logInfo("proxy.anthropic.request", "Forwarding to Anthropic", {
    method: request.method,
    url: upstreamUrl,
    headers: Object.fromEntries(request.headers.entries()),
    body: parsed ?? body,
    ...identity,
  });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" ? body : undefined,
    });
  } catch (error) {
    logError("proxy.anthropic.upstream_error", "Failed to reach Anthropic API", error);
    return jsonError("upstream unreachable", 502);
  }

  if (!isStreaming) {
    const responseBody = await upstream.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseBody);
    } catch {
      // non-JSON response — forward as-is
    }

    logInfo("proxy.anthropic.response", "Anthropic response", {
      status: upstream.status,
      headers: Object.fromEntries(upstream.headers.entries()),
      body: responseData ?? responseBody,
      latency_ms: elapsedMs(startedAt),
      ...identity,
    });

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Streaming: pipe SSE events through, inspecting for usage data
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();

  const streamContext = {
    model: parsed?.model,
    inputTokens: 0,
    outputTokens: 0,
    stopReason: undefined as string | undefined,
  };

  (async () => {
    try {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Forward raw bytes immediately
        await writer.write(value);

        // Inspect for usage data (non-blocking parse)
        buffer += decoder.decode(value, { stream: true });
        buffer = extractSSEUsage(buffer, streamContext);
      }
    } catch (error) {
      logError("proxy.anthropic.stream_error", "SSE relay error", error);
    } finally {
      await writer.close();

      logInfo("proxy.anthropic.response", "Anthropic stream complete", {
        model: streamContext.model,
        input_tokens: streamContext.inputTokens,
        output_tokens: streamContext.outputTokens,
        stop_reason: streamContext.stopReason,
        latency_ms: elapsedMs(startedAt),
        ...identity,
      });
    }
  })();

  return new Response(readable, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Parses Claude Code's metadata.user_id format:
// "user_<hash>_account_<uuid>_session_<uuid>"
function parseMetadataUserId(userId?: string): { user_hash?: string; account_id?: string; session_id?: string } {
  if (!userId) return {};
  const match = userId.match(/^user_([a-f0-9]+)_account_([a-f0-9-]+)_session_([a-f0-9-]+)$/);
  if (!match) return { user_hash: userId };
  return {
    user_hash: match[1],
    account_id: match[2],
    session_id: match[3],
  };
}

type StreamContext = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
};

function extractSSEUsage(buffer: string, ctx: StreamContext): string {
  const lines = buffer.split("\n");
  // Keep the last incomplete line in the buffer
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") continue;

    try {
      const event = JSON.parse(data);

      // message_start contains input token count
      if (event.type === "message_start" && event.message?.usage) {
        ctx.inputTokens = event.message.usage.input_tokens ?? 0;
        ctx.model = event.message.model ?? ctx.model;
      }

      // message_delta contains output token count and stop reason
      if (event.type === "message_delta") {
        if (event.usage?.output_tokens) {
          ctx.outputTokens = event.usage.output_tokens;
        }
        if (event.delta?.stop_reason) {
          ctx.stopReason = event.delta.stop_reason;
        }
      }
    } catch {
      // partial JSON or non-JSON data line — skip
    }
  }

  return remainder;
}
