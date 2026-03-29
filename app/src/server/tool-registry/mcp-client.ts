/**
 * MCP Client Module
 *
 * Provides functions to connect to upstream MCP servers, list tools,
 * call tools, and disconnect. Supports SSE and Streamable HTTP transports.
 *
 * The McpClientFactory type is injectable via ServerDependencies so tests
 * can substitute an InMemoryTransport-based factory.
 *
 * ADR-071: connect-per-request -- connections are established per proxy
 * request, reused within request for multiple tool calls, and closed
 * when the proxy request completes. No persistent connection pool.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  ServerCapabilities,
  Implementation as ServerInfo,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpTransport } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of Client.listTools() */
export type ToolListResult = Awaited<ReturnType<Client["listTools"]>>;

/** Result of Client.callTool() */
export type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

/**
 * Result of a successful MCP server connection.
 */
export type McpConnectionResult = {
  client: Client;
  serverInfo: ServerInfo;
  capabilities: ServerCapabilities;
};

/**
 * Injectable factory for MCP client operations.
 * Injected via ServerDependencies so tests can provide a mock implementation
 * backed by InMemoryTransport.
 */
export type McpClientFactory = {
  connect: (
    url: string,
    transport: McpTransport,
    headers?: Record<string, string>,
  ) => Promise<McpConnectionResult>;
  fetchToolList: (client: Client) => Promise<ToolListResult>;
  callTool: (
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  disconnect: (client: Client) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Build auth headers from optional header map.
 * Pure pass-through -- credential formatting (Bearer, Basic, api_key header)
 * is handled by the credential provider layer before reaching this function.
 */
export function buildAuthHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  return headers ?? {};
}

/**
 * Create the appropriate MCP transport based on transport type.
 * Injects auth headers into the transport's requestInit.
 */
export function createTransport(
  url: string,
  transportType: McpTransport,
  headers?: Record<string, string>,
): Transport {
  const parsedUrl = new URL(url);
  const authHeaders = buildAuthHeaders(headers);
  const requestInit: RequestInit = {
    headers: authHeaders,
  };

  switch (transportType) {
    case "sse":
      return new SSEClientTransport(parsedUrl, {
        fetch: createFetchWithHeaders(authHeaders),
        requestInit,
      });
    case "streamable-http":
      return new StreamableHTTPClientTransport(parsedUrl, {
        requestInit,
      });
  }
}

// ---------------------------------------------------------------------------
// Client operations
// ---------------------------------------------------------------------------

/**
 * Connect to an MCP server, perform the initialize handshake,
 * and return the client with server metadata.
 *
 * Uses AbortController with 10s timeout per acceptance criteria.
 */
async function connectToMcpServer(
  url: string,
  transportType: McpTransport,
  headers?: Record<string, string>,
): Promise<McpConnectionResult> {
  const transport = createTransport(url, transportType, headers);

  const client = new Client(
    { name: "osabio-tool-registry", version: "1.0.0" },
    { capabilities: {} },
  );

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    CONNECTION_TIMEOUT_MS,
  );

  try {
    await client.connect(transport, { signal: abortController.signal });
  } catch (error) {
    // Clean up on connection failure
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors
    }

    if (abortController.signal.aborted) {
      throw new Error(
        `MCP connection timeout: failed to connect to ${url} within ${CONNECTION_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const serverInfo = client.getServerVersion() ?? {
    name: "unknown",
    version: "unknown",
  };
  const capabilities = client.getServerCapabilities() ?? {};

  return { client, serverInfo, capabilities };
}

/**
 * Fetch the list of tools from a connected MCP client.
 */
async function fetchToolList(client: Client): Promise<ToolListResult> {
  return client.listTools();
}

/**
 * Call a tool on a connected MCP client.
 */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args });
}

/**
 * Gracefully disconnect from an MCP server.
 */
async function disconnectMcpServer(client: Client): Promise<void> {
  await client.close();
}

// ---------------------------------------------------------------------------
// Factory constructor
// ---------------------------------------------------------------------------

/**
 * Create the production McpClientFactory.
 * This is the real implementation wired into ServerDependencies.
 */
export function createMcpClientFactory(): McpClientFactory {
  return {
    connect: connectToMcpServer,
    fetchToolList,
    callTool,
    disconnect: disconnectMcpServer,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a fetch wrapper that injects auth headers into SSE EventSource requests.
 * The SSE transport's eventSourceInit.fetch is called for the initial GET request.
 */
function createFetchWithHeaders(
  headers: Record<string, string>,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers);
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value);
    }
    return fetch(input, { ...init, headers: mergedHeaders });
  };
}
