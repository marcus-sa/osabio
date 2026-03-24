/**
 * OpenClaw CLI Smoke Tests — Protocol Compliance
 *
 * Spawns the real OpenClaw CLI (`npx openclaw`) as a subprocess against
 * Brain's gateway endpoint. These tests catch protocol compliance issues
 * that the internal gateway-test-kit cannot detect, because the CLI is an
 * independent protocol implementation.
 *
 * What this catches:
 * - Protocol framing bugs (CLI has its own parser)
 * - connect handshake compliance (connect.challenge → connect → hello-ok)
 * - Method naming mismatches (CLI expects sessions.*, not agent.*)
 * - hello-ok payload format issues
 *
 * Prerequisites:
 * - `openclaw` npm package available (devDependency or via npx)
 * - Brain gateway running with auth token configured
 *
 * Driving port: `openclaw gateway call` subprocess → WS at /api/gateway
 * Scenarios: CLI-1 through CLI-4
 *
 * All scenarios @skip until R1 auth is implemented (CLI needs real connect handshake).
 */
import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";

const getRuntime = setupAcceptanceSuite("gateway-cli-smoke");

/**
 * Execute an OpenClaw CLI gateway call against the test server.
 * Returns { exitCode, stdout, stderr }.
 */
async function openclawGatewayCall(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/gateway";
  const args = [
    "npx", "openclaw", "gateway", "call", method,
    "--url", wsUrl,
    "--token", "test-gateway-token",
    "--timeout", String((options?.timeoutMs ?? 10_000) / 1000),
  ];

  if (params) {
    args.push("--params", JSON.stringify(params));
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Ensure CLI doesn't try to use a local gateway
      OPENCLAW_GATEWAY_TOKEN: "test-gateway-token",
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

describe("Gateway CLI Smoke: OpenClaw CLI Protocol Compliance", () => {
  // CLI-1: OpenClaw CLI connects to Brain gateway (AC-1.1)
  // The CLI must successfully complete the connect.challenge → connect → hello-ok handshake.
  // Uses sessions.list as the health-check method since it's implemented in R2
  // and exercises the full auth + method dispatch path.
  it.skip("CLI-1: OpenClaw CLI connects to Brain gateway", async () => {
    const { baseUrl } = getRuntime();

    // sessions.list is a lightweight method that proves:
    // 1. CLI completed connect handshake (hello-ok received)
    // 2. Method dispatch works (sessions.list routed correctly)
    // 3. Response serialization is CLI-compatible
    const result = await openclawGatewayCall(baseUrl, "sessions.list");

    // CLI should exit cleanly (0) if connect handshake succeeded
    expect(result.exitCode).toBe(0);

    // Should have received a JSON response with sessions array
    const parsed = JSON.parse(result.stdout);
    expect(parsed.sessions).toBeDefined();
  });

  // CLI-2: sessions.list returns valid JSON (AC-2.3)
  // Verifies the CLI can call sessions.list and Brain responds with correct format
  it.skip("CLI-2: CLI sessions.list returns valid JSON response", async () => {
    const { baseUrl } = getRuntime();

    const result = await openclawGatewayCall(baseUrl, "sessions.list");
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.sessions).toBeDefined();
    expect(Array.isArray(parsed.sessions)).toBe(true);
  });

  // CLI-3: tools.catalog returns agent's granted tools (AC-2.5)
  // Verifies the CLI can discover tools the agent has access to
  it.skip("CLI-3: CLI tools.catalog returns agent's granted tools", async () => {
    const { baseUrl } = getRuntime();

    const result = await openclawGatewayCall(baseUrl, "tools.catalog");
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.tools).toBeDefined();
    expect(Array.isArray(parsed.tools)).toBe(true);
  });

  // CLI-4: config.get returns gateway capabilities (AC-2.6)
  // Verifies Brain's gateway config response is parseable by the CLI
  it.skip("CLI-4: CLI config.get returns gateway capabilities", async () => {
    const { baseUrl } = getRuntime();

    const result = await openclawGatewayCall(baseUrl, "config.get");
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.gateway).toBeDefined();
    expect(parsed.gateway.protocol).toBe(3);
  });
});
