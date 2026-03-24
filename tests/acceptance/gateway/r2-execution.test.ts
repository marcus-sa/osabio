/**
 * Release 2: Core Execution Pipeline — OpenClaw Gateway
 *
 * Full orchestrator pipeline, exec approval, session management (sessions.* namespace),
 * tool catalog, config, and trace history.
 *
 * DEPENDENCIES (enable in order):
 * - All R1 tests must pass (auth required for any method call)
 * - R2-1: Full pipeline (foundation for all R2 tests)
 * - R2-2, R2-3: Exec approval (requires R2-1 — agent method must work)
 * - R2-4: sessions.list (requires R2-1 — sessions must exist)
 * - R2-5, R2-6: agent.status/wait backward compat (requires R2-1)
 * - R2-7: sessions.history (requires R2-1 — completed sessions needed)
 * - R2-8: tools.catalog (independent of R2-1, only requires auth)
 * - R2-9: method_not_supported (independent, only requires auth)
 * - R2-10: sessions.patch (requires R2-1 — active session needed)
 * - R2-11: File change streaming (requires R2-1)
 * - R2-12: config.get (independent, only requires auth)
 *
 * Driving port: WebSocket at /api/gateway
 * Scenarios: R2-1 through R2-12
 *
 * All scenarios @skip until R1 passes.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  connectGatewayWithSkeletonAuth,
  isDoneEvent,
  seedDecisions,
  seedConstraints,
  seedProject,
} from "./gateway-test-kit";

const getRuntime = setupAcceptanceSuite("gateway-r2-execution");

describe("Gateway R2: Core Execution Pipeline", () => {
  // R2-1: Full pipeline with context + policy + budget (AC-2.1)
  // Seeds workspace with exact counts and asserts context summary matches.
  it.skip("R2-1: agent method returns context summary and authorization result", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Seed workspace with exact known data
    const workspaceRecord = new RecordId("workspace", "skeleton-test-ws");
    const project = await seedProject(surreal, workspaceRecord, "R2 Test Project");
    await seedDecisions(surreal, workspaceRecord, project, 3);
    await seedConstraints(surreal, workspaceRecord, project, 2);
    // TODO: Seed 1 learning for agent type "openclaw"
    // TODO: Seed active policy: max_risk_level "medium", budget_limit $10.00

    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("agent", {
      task: "implement rate limiting",
    });

    expect(res.ok).toBe(true);
    const payload = res.payload as {
      runId: string;
      sessionId: string;
      contextSummary: {
        decisions: number;
        constraints: number;
        learnings: number;
        observations: number;
      };
      authorization: { policy_result: string; budget_result: string };
    };

    // Assert context summary matches seeded data exactly
    expect(payload.contextSummary.decisions).toBe(3);
    expect(payload.contextSummary.constraints).toBe(2);
    // TODO: uncomment once learning seeding is wired
    // expect(payload.contextSummary.learnings).toBe(1);
    expect(payload.authorization.policy_result).toBe("pass");
    expect(payload.authorization.budget_result).toBe("pass");

    client.close();
  });

  // R2-2: Exec approval forwards to client and back (AC-2.2)
  it.skip("R2-2: exec approval flow — request forwarded, approval accepted", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", {
      task: "install dependencies",
    });
    expect(agentRes.ok).toBe(true);

    // Wait for exec.request event
    const execEvent = await client.waitForEvent("exec.request", 15_000);
    const { requestId, command } = execEvent.payload as {
      requestId: string;
      command: string;
    };
    expect(typeof requestId).toBe("string");
    expect(typeof command).toBe("string");

    // Approve the exec request
    const approveRes = await client.request("exec.approve", { requestId });
    expect(approveRes.ok).toBe(true);
    expect(
      (approveRes.payload as { decision: string }).decision,
    ).toBe("approved");

    client.close();
  });

  // R2-3: Exec denial prevents execution (AC-2.2)
  it.skip("R2-3: exec denial prevents agent from executing command", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", {
      task: "delete temp files",
    });
    expect(agentRes.ok).toBe(true);

    const execEvent = await client.waitForEvent("exec.request", 15_000);
    const { requestId } = execEvent.payload as { requestId: string };

    const denyRes = await client.request("exec.deny", { requestId });
    expect(denyRes.ok).toBe(true);
    expect((denyRes.payload as { decision: string }).decision).toBe("denied");

    client.close();
  });

  // R2-4: sessions.list returns active and completed sessions (AC-2.3)
  it.skip("R2-4: sessions.list returns sessions for this identity", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    // Start a session first
    const agentRes = await client.request("agent", { task: "say hello" });
    expect(agentRes.ok).toBe(true);

    // List sessions
    const listRes = await client.request("sessions.list", { status: "all" });
    expect(listRes.ok).toBe(true);

    const { sessions } = listRes.payload as {
      sessions: Array<{
        runId: string;
        sessionId: string;
        status: string;
        task: string;
        startedAt: string;
      }>;
    };
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].runId).toBeDefined();
    expect(sessions[0].task).toBeDefined();
    expect(sessions[0].status).toBeDefined();

    client.close();
  });

  // R2-5: agent.status returns session state — backward compat (AC-2.3)
  it.skip("R2-5: agent.status returns current session state", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", { task: "say hello" });
    const { runId } = agentRes.payload as { runId: string };

    const statusRes = await client.request("agent.status", { runId });
    expect(statusRes.ok).toBe(true);

    const status = statusRes.payload as {
      runId: string;
      status: string;
      startedAt: string;
    };
    expect(status.runId).toBe(runId);
    expect(["spawning", "active", "idle", "completed"]).toContain(
      status.status,
    );

    client.close();
  });

  // R2-6: agent.wait returns on completion (AC-2.3)
  it.skip("R2-6: agent.wait blocks until session completes", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", { task: "say hi" });
    const { runId } = agentRes.payload as { runId: string };

    const waitRes = await client.request("agent.wait", { runId });
    expect(waitRes.ok).toBe(true);

    const result = waitRes.payload as { runId: string; status: string };
    expect(result.status).toBe("completed");

    client.close();
  });

  // R2-7: sessions.history returns trace tree (AC-2.4)
  it.skip("R2-7: sessions.history returns hierarchical trace", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    // Run a session to completion
    const agentRes = await client.request("agent", { task: "say hello" });
    const { runId } = agentRes.payload as { runId: string };
    await client.request("agent.wait", { runId });

    // Query trace via sessions.history
    const historyRes = await client.request("sessions.history", { runId });
    expect(historyRes.ok).toBe(true);

    const { trace } = historyRes.payload as {
      runId: string;
      trace: Array<{
        id: string;
        type: string;
        children: unknown[];
      }>;
    };
    expect(trace.length).toBeGreaterThan(0);
    expect(trace[0].type).toBeDefined();
    // Verify hierarchical structure — root node should have children
    expect(trace[0].children).toBeDefined();

    client.close();
  });

  // R2-8: tools.catalog returns only agent's granted tools (AC-2.5)
  // Verifies tool access scoping: agent sees only tools granted via authority scopes,
  // not the entire workspace registry.
  it("R2-8: tools.catalog returns only tools the agent has access to", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Seed workspace with 5 MCP tools across 2 servers
    // Grant the skeleton agent access to only 3 of them via authority scopes
    // TODO: Seed mcp_tool records and tool grants when implementing

    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("tools.catalog", {});
    expect(res.ok).toBe(true);

    const { tools } = res.payload as {
      tools: Array<{
        name: string;
        description: string;
        server: string;
      }>;
    };
    expect(Array.isArray(tools)).toBe(true);

    // Once tool seeding is wired, assert scoping:
    // expect(tools.length).toBe(3);  // Only the 3 granted tools, not all 5
    // const toolNames = tools.map(t => t.name).sort();
    // expect(toolNames).toEqual(["granted-tool-1", "granted-tool-2", "granted-tool-3"]);

    client.close();
  });

  // R2-9: Unsupported method returns method_not_supported (AC-2.6)
  it("R2-9: unimplemented method returns method_not_supported", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("config.apply", { some: "config" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("method_not_supported");
    }

    // Connection should still be open
    expect(client.isOpen()).toBe(true);

    client.close();
  });

  // R2-10: sessions.patch updates model mid-session (AC-2.3)
  it.skip("R2-10: sessions.patch updates session properties mid-flight", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", { task: "long task" });
    const { runId } = agentRes.payload as { runId: string };

    const patchRes = await client.request("sessions.patch", {
      runId,
      model: "claude-haiku-4-5",
      thinkingLevel: "low",
    });
    expect(patchRes.ok).toBe(true);

    const { applied } = patchRes.payload as {
      runId: string;
      applied: string[];
    };
    expect(applied).toContain("model");
    expect(applied).toContain("thinkingLevel");

    client.close();
  });

  // R2-11: File change streams as lifecycle event
  it.skip("R2-11: file change events stream as lifecycle phase", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", {
      task: "create a file called test.txt",
    });
    expect(agentRes.ok).toBe(true);

    const events = await client.collectEvents(isDoneEvent, 30_000);

    const fileEvents = events.filter(
      (e) =>
        (e.payload as { stream: string })?.stream === "lifecycle" &&
        (e.payload as { data: { phase: string } })?.data?.phase ===
          "file_change",
    );
    expect(fileEvents.length).toBeGreaterThan(0);

    const firstFile = fileEvents[0].payload as {
      data: { phase: string; path: string; changeType: string };
    };
    expect(firstFile.data.path).toBeDefined();
    expect(["created", "modified", "deleted"]).toContain(
      firstFile.data.changeType,
    );

    client.close();
  });

  // R2-12: config.get returns gateway capabilities (AC-2.6)
  it("R2-12: config.get returns read-only gateway configuration", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const res = await client.request("config.get", {});
    expect(res.ok).toBe(true);

    const { gateway } = res.payload as {
      gateway: {
        version: string;
        protocol: number;
        features: string[];
        tickIntervalMs: number;
      };
    };
    expect(gateway.protocol).toBe(3);
    expect(Array.isArray(gateway.features)).toBe(true);
    expect(gateway.tickIntervalMs).toBeGreaterThan(0);

    client.close();
  });
});
