/**
 * Release 3: Governance & Multi-Agent — OpenClaw Gateway
 *
 * Policy enforcement, budget limits, presence tracking, model listing,
 * and connection resilience.
 *
 * DEPENDENCIES (enable in order):
 * - All R1 + R2 tests must pass (auth + execution pipeline required)
 * - R3-1, R3-2: Policy/budget (independent of each other, require R2-1)
 * - R3-3, R3-4: Presence (require at least R1 — auth for both connections)
 * - R3-5: model.list (independent, requires auth only)
 * - R3-6: Reconnect resilience (requires R2-1 + R2-5 — agent + status methods)
 *
 * Driving port: WebSocket at /api/gateway
 * Scenarios: R3-1 through R3-6
 *
 * All scenarios @skip until R2 passes.
 */
import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  connectGateway,
  connectGatewayWithSkeletonAuth,
} from "./gateway-test-kit";

const getRuntime = setupAcceptanceSuite("gateway-r3-governance");

describe("Gateway R3: Governance & Multi-Agent", () => {
  // R3-1: Policy violation returns structured error (AC-3.1)
  it.skip("R3-1: policy violation returns error with policy detail", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Seed policy: max_risk_level "low" for this identity
    // Seed work that would be classified as risk_level "high"

    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("agent", {
      task: "delete production database",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("policy_violation");

      const details = res.error.details as {
        policy: string;
        rule: string;
        allowed: string;
        actual: string;
      };
      expect(details.rule).toBe("max_risk_level");
      expect(details.allowed).toBe("low");
      expect(details.actual).toBe("high");
    }

    client.close();
  });

  // R3-2: Budget exceeded returns spend details (AC-3.2)
  it.skip("R3-2: budget exceeded returns limit and spend details", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Seed identity with budget_limit $5.00 and current spend $4.90

    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("agent", {
      task: "refactor auth module",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("budget_exceeded");

      const details = res.error.details as {
        limit: number;
        spent: number;
        remaining: number;
      };
      expect(details.limit).toBe(5.0);
      expect(details.spent).toBe(4.9);
      expect(details.remaining).toBeCloseTo(0.1, 2);
    }

    client.close();
  });

  // R3-3: Presence query returns connected devices (AC-3.3)
  // Both connections must be fully active before querying presence.
  it("R3-3: presence query returns online devices", async () => {
    const { baseUrl } = getRuntime();

    // Connect two clients and wait for both to be fully active
    const client1 = await connectGatewayWithSkeletonAuth(baseUrl);
    const client2 = await connectGatewayWithSkeletonAuth(baseUrl);

    // Wait for presence.update events to confirm both are registered.
    // Each new connection triggers a presence broadcast to existing connections.
    // client1 should receive a presence.update when client2 connects.
    await client1.waitForEvent(
      (e) =>
        e.event === "presence.update" &&
        (e.payload as { status: string })?.status === "online",
      5_000,
    );

    const res = await client1.request("presence", {});
    expect(res.ok).toBe(true);

    const { devices } = res.payload as {
      devices: Array<{
        deviceFingerprint: string;
        status: string;
        agentType: string;
      }>;
    };
    expect(devices.length).toBeGreaterThanOrEqual(2);

    const onlineDevices = devices.filter((d) => d.status === "online");
    expect(onlineDevices.length).toBeGreaterThanOrEqual(2);

    client1.close();
    client2.close();
  });

  // R3-4: Disconnect broadcasts offline event (AC-3.3)
  it.skip("R3-4: disconnect broadcasts presence offline event", async () => {
    const { baseUrl } = getRuntime();

    const client1 = await connectGatewayWithSkeletonAuth(baseUrl);
    const client2 = await connectGatewayWithSkeletonAuth(baseUrl);

    // Wait for client2's online presence to be visible
    await client1.waitForEvent(
      (e) =>
        e.event === "presence.update" &&
        (e.payload as { status: string })?.status === "online",
      5_000,
    );

    // Set up offline listener BEFORE closing client2
    const offlinePromise = client1.waitForEvent(
      (e) =>
        e.event === "presence.update" &&
        (e.payload as { status: string })?.status === "offline",
      5_000,
    );

    // Close client2 — should trigger offline broadcast
    client2.close();

    const offlineEvent = await offlinePromise;
    expect(offlineEvent.payload).toBeDefined();

    const { status } = offlineEvent.payload as {
      device: string;
      status: string;
    };
    expect(status).toBe("offline");

    client1.close();
  });

  // R3-5: Model list returns providers without API keys (AC-3.4)
  it("R3-5: model.list returns configured models without API keys", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("model.list", {});
    expect(res.ok).toBe(true);

    const { models } = res.payload as {
      models: Array<{ id: string; provider: string }>;
    };
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeDefined();
    expect(models[0].provider).toBeDefined();

    // Verify no API keys in response
    const responseStr = JSON.stringify(res.payload);
    expect(responseStr).not.toContain("sk-");
    expect(responseStr).not.toContain("api_key");
    expect(responseStr).not.toContain("apiKey");

    client.close();
  });

  // R3-6: Reconnect resumes session via agent.status (AC-3.5)
  // Verifies the session continues running server-side after disconnect,
  // and the reconnected client can query its status (still active, not lost).
  it.skip("R3-6: reconnect after disconnect resumes active session", async () => {
    const { baseUrl } = getRuntime();

    // Connect and start a long-running session
    const client1 = await connectGatewayWithSkeletonAuth(baseUrl);
    const agentRes = await client1.request("agent", {
      task: "long running task that takes a while",
    });
    expect(agentRes.ok).toBe(true);
    const { runId } = agentRes.payload as { runId: string };

    // Verify session is active before disconnecting
    const statusBefore = await client1.request("agent.status", { runId });
    expect(statusBefore.ok).toBe(true);
    const statusBeforePayload = statusBefore.payload as { status: string };
    expect(["spawning", "active", "idle"]).toContain(
      statusBeforePayload.status,
    );

    // Disconnect — session MUST continue server-side
    client1.close();

    // Reconnect immediately
    const client2 = await connectGatewayWithSkeletonAuth(baseUrl);

    // Query session status — must still be active (not completed, not lost)
    const statusRes = await client2.request("agent.status", { runId });
    expect(statusRes.ok).toBe(true);

    const status = statusRes.payload as { runId: string; status: string };
    expect(status.runId).toBe(runId);
    // Session should still be running, not terminated by disconnect
    expect(["spawning", "active", "idle"]).toContain(status.status);

    client2.close();
  });
});
