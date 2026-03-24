/**
 * Walking Skeleton — OpenClaw Gateway Protocol
 *
 * Validates the full gateway pipeline end-to-end:
 * WS connect → skeleton auth → agent method → orchestrator →
 * token streaming via WS events → session completion → trace recorded
 *
 * Driving port: WebSocket at /api/gateway
 * Scenarios: WS-1 through WS-5
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  connectGateway,
  connectGatewayWithSkeletonAuth,
  isDoneEvent,
  isAssistantEvent,
  seedDecisions,
  seedConstraints,
  seedProject,
} from "./gateway-test-kit";

const getRuntime = setupAcceptanceSuite("gateway-walking-skeleton");

describe("Gateway Walking Skeleton", () => {
  // WS-1: WebSocket upgrade succeeds (AC-0.1)
  // When a client sends an HTTP upgrade request to "/api/gateway"
  // Then Brain upgrades the connection to WebSocket
  it("WS-1: WebSocket upgrade to /api/gateway succeeds", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    expect(client.isOpen()).toBe(true);

    client.close();
  });

  // WS-5: Error path — proves /api/gateway rejects non-WebSocket requests.
  // This is part of the walking skeleton's driving-port validation: only WS upgrade is allowed.
  it("WS-5: HTTP GET to /api/gateway returns 426 Upgrade Required", async () => {
    const { baseUrl } = getRuntime();
    const res = await fetch(`${baseUrl}/api/gateway`);

    expect(res.status).toBe(426);
  });

  // WS-2: Agent method returns runId with context summary (AC-0.2)
  // Given a WebSocket connection with skeleton identity
  // And workspace has 2 decisions and 1 constraint
  // When client sends agent method
  // Then Brain responds with runId, sessionId, contextSummary matching seeded data
  it("WS-2: agent method returns runId with context summary", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Seed workspace with known data for context injection verification.
    // The skeleton auth creates a workspace — we need to seed into it.
    // For walking skeleton, we use a hardcoded workspace ID matching the skeleton identity.
    const workspaceRecord = new RecordId("workspace", "skeleton-test-ws");
    const project = await seedProject(surreal, workspaceRecord, "Gateway Test Project");
    await seedDecisions(surreal, workspaceRecord, project, 2);
    await seedConstraints(surreal, workspaceRecord, project, 1);

    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const response = await client.request("agent", {
      task: "implement auth module",
    });

    expect(response.ok).toBe(true);

    const payload = response.payload as {
      runId: string;
      sessionId: string;
      contextSummary: {
        decisions: number;
        constraints: number;
        learnings: number;
        observations: number;
      };
    };

    // Verify response shape
    expect(payload.runId).toBeDefined();
    expect(typeof payload.runId).toBe("string");
    expect(payload.sessionId).toBeDefined();
    expect(typeof payload.sessionId).toBe("string");

    // Verify context injection matches seeded data
    expect(payload.contextSummary.decisions).toBe(2);
    expect(payload.contextSummary.constraints).toBe(1);
    expect(payload.contextSummary.learnings).toBe(0);
    expect(payload.contextSummary.observations).toBe(0);

    client.close();
  });

  // WS-3: Token events stream with seq numbers (AC-0.3)
  // Given an active agent session via the gateway
  // When the orchestrator produces agent_token events
  // Then the client receives event frames with monotonically increasing seq
  it("WS-3: token events stream with monotonically increasing seq numbers", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    // Submit work to start streaming
    const agentRes = await client.request("agent", {
      task: "say hello",
    });
    expect(agentRes.ok).toBe(true);

    // Collect events until we see the done event
    const events = await client.collectEvents(isDoneEvent, 30_000);

    // Must have received at least one assistant stream event (token delta)
    const assistantEvents = events.filter(isAssistantEvent);
    expect(assistantEvents.length).toBeGreaterThan(0);

    // Verify monotonically increasing seq numbers
    const seqNumbers = events
      .filter((e) => e.seq !== undefined)
      .map((e) => e.seq!);
    for (let i = 1; i < seqNumbers.length; i++) {
      expect(seqNumbers[i]).toBeGreaterThan(seqNumbers[i - 1]);
    }

    client.close();
  });

  // WS-4: Session completes with done event (AC-0.3 completion)
  // Given a streaming agent session
  // When the agent finishes execution
  // Then a lifecycle event with phase "done" is received
  it("WS-4: session completes with lifecycle done event", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGatewayWithSkeletonAuth(baseUrl);

    const agentRes = await client.request("agent", {
      task: "say hello world",
    });
    expect(agentRes.ok).toBe(true);

    // Wait specifically for the done event using predicate
    const doneEvent = await client.waitForEvent(isDoneEvent, 30_000);

    // Verify done event structure
    const payload = doneEvent.payload as {
      stream: string;
      data: { phase: string };
    };
    expect(payload.stream).toBe("lifecycle");
    expect(payload.data.phase).toBe("done");

    client.close();
  });
});
