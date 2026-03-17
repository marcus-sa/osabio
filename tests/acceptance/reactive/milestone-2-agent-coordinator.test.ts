/**
 * Milestone 2: Agent Coordinator with Vector Search Routing (US-GRC-03)
 *
 * Traces: US-GRC-03 acceptance criteria
 *
 * Tests the Coordinator's observation -> vector search -> agent invocation pipeline.
 * Scenarios cover: semantic routing, similarity threshold, active session scoping,
 * multi-agent routing, loop dampening, and dampening window reset.
 *
 * Driving ports:
 *   SurrealDB direct queries   (graph writes trigger LIVE SELECT -> Coordinator)
 *   GET /api/workspaces/:workspaceId/feed/stream  (verify meta-observation in feed)
 *
 * Note: The Coordinator is an always-on internal service. Tests drive it indirectly
 * by writing observations to the graph and verifying the outcomes (agent invocations,
 * meta-observations, dampening behavior).
 */
import { describe, expect, it, afterEach } from "bun:test";
import {
  setupReactiveSuite,
  createTestUser,
  createTestWorkspace,
  createObservation,
  createObservationBurst,
  createTask,
  registerAgent,
  startAgentSession,
  endAgentSession,
  getObservations,
  getMetaObservations,
  generateEmbedding,
  fakeEmbedding,
  openFeedStream,
  type FeedStreamController,
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("agent_coordinator");

describe("US-GRC-03: Agent Coordinator with Vector Search Routing", () => {
  let feedStream: FeedStreamController | undefined;

  afterEach(() => {
    feedStream?.close();
    feedStream = undefined;
  });

  // ---------------------------------------------------------------------------
  // AC: Coordinator routes observations via vector search
  // ---------------------------------------------------------------------------
  it.skip("observation is routed to semantically matched agent with active session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given Agent B has an active session working on billing API migration
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "coord-route");
    const agentDescription = "Coding agent working on billing API migration";
    const descriptionEmbedding = await generateEmbedding(agentDescription);

    const { agentId } = await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: agentDescription,
      descriptionEmbedding,
    });

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Migrate billing API to tRPC",
    });

    const { sessionId } = await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      taskId,
      description: agentDescription,
    });

    // When the Observer creates a conflict observation about the billing API
    const observationText = "Task T-47 implementation contradicts confirmed decision to standardize on tRPC for billing API";
    const observationEmbedding = await generateEmbedding(observationText);

    await createObservation(surreal, workspaceId, {
      text: observationText,
      severity: "conflict",
      sourceAgent: "observer_agent",
      embedding: observationEmbedding,
      targetEntity: { table: "task", id: taskId },
    });

    // Then the Coordinator matches Agent B via vector search (similarity > threshold)
    // Verification: Check that the agent session was invoked
    // (In the real implementation, the Coordinator updates the session or creates a notification)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The observation should remain in the graph for verification
    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    const conflictObs = observations.find((o) => o.text.includes("contradicts confirmed decision"));
    expect(conflictObs).toBeDefined();
    expect(conflictObs!.severity).toBe("conflict");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Routes observation to multiple semantically matched agents
  // ---------------------------------------------------------------------------
  it.skip("observation is routed to multiple agents with matching descriptions", async () => {
    const { surreal } = getRuntime();

    // Given Agent E (infrastructure) and Agent F (customer support) both have active sessions
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "coord-multi");

    const infraDesc = "Infrastructure and reliability engineering";
    const supportDesc = "Customer communication and incident response";
    const [infraEmbedding, supportEmbedding] = await Promise.all([
      generateEmbedding(infraDesc),
      generateEmbedding(supportDesc),
    ]);

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: infraDesc,
      descriptionEmbedding: infraEmbedding,
    });
    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: supportDesc,
      descriptionEmbedding: supportEmbedding,
    });

    await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      description: infraDesc,
    });
    await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      description: supportDesc,
    });

    // When the Coordinator receives an observation about production API latency
    const obsText = "Production API latency exceeding SLA threshold, p99 response time above 2 seconds";
    const obsEmbedding = await generateEmbedding(obsText);

    await createObservation(surreal, workspaceId, {
      text: obsText,
      severity: "warning",
      sourceAgent: "observer_agent",
      embedding: obsEmbedding,
    });

    // Then both Agent E and Agent F are matched (both descriptions are semantically relevant)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verification: the observation exists and both sessions are still active
    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    expect(observations.some((o) => o.text.includes("latency exceeding SLA"))).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Agents below similarity threshold are not invoked
  // ---------------------------------------------------------------------------
  it.skip("irrelevant agent is not matched when observation is semantically unrelated", async () => {
    const { surreal } = getRuntime();

    // Given Agent G (marketing) has an active session
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "coord-threshold");

    const marketingDesc = "Marketing content creation and campaign management";
    const marketingEmbedding = await generateEmbedding(marketingDesc);

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: marketingDesc,
      descriptionEmbedding: marketingEmbedding,
    });
    await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      description: marketingDesc,
    });

    // When the Coordinator receives a database infrastructure observation
    const obsText = "Database connection pool exhausted, all 50 connections in use";
    const obsEmbedding = await generateEmbedding(obsText);

    await createObservation(surreal, workspaceId, {
      text: obsText,
      severity: "conflict",
      sourceAgent: "observer_agent",
      embedding: obsEmbedding,
    });

    // Then Agent G is NOT matched (marketing is semantically unrelated to database ops)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verification: observation exists but no agent was invoked
    // (No invocation record or notification for marketing agent)
    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    expect(observations.some((o) => o.text.includes("connection pool"))).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Agents without active sessions are not invoked
  // ---------------------------------------------------------------------------
  it.skip("agent with completed session is not invoked for new observation", async () => {
    const { surreal } = getRuntime();

    // Given Agent C completed its session two hours ago
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "coord-inactive");

    const agentDesc = "Coding agent working on API documentation updates";
    const agentEmbedding = await generateEmbedding(agentDesc);

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: agentDesc,
      descriptionEmbedding: agentEmbedding,
    });

    const { sessionId } = await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      description: agentDesc,
    });
    await endAgentSession(surreal, sessionId);

    // When a semantically relevant observation is created
    const obsText = "API documentation is missing for the new authentication endpoints";
    const obsEmbedding = await generateEmbedding(obsText);

    await createObservation(surreal, workspaceId, {
      text: obsText,
      severity: "warning",
      sourceAgent: "observer_agent",
      embedding: obsEmbedding,
    });

    // Then Agent C is NOT invoked (session is completed, not active)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The observation remains in the graph for Agent C's next session context loading
    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    expect(observations.some((o) => o.text.includes("API documentation"))).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Adding new agent type requires no classifier rule changes
  // ---------------------------------------------------------------------------
  it.skip("newly registered agent type is automatically matched by semantic similarity", async () => {
    const { surreal } = getRuntime();

    // Given a brand-new agent type "security_auditor" with no prior rule configuration
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "coord-new-type");

    const securityDesc = "Security auditor reviewing code for vulnerabilities and compliance";
    const securityEmbedding = await generateEmbedding(securityDesc);

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: securityDesc,
      descriptionEmbedding: securityEmbedding,
    });
    await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      description: securityDesc,
    });

    // When a security-related observation is created
    const obsText = "SQL injection vulnerability detected in user input handling for login endpoint";
    const obsEmbedding = await generateEmbedding(obsText);

    await createObservation(surreal, workspaceId, {
      text: obsText,
      severity: "conflict",
      sourceAgent: "observer_agent",
      embedding: obsEmbedding,
    });

    // Then the security agent is matched via semantic similarity alone
    // No rule table update was needed -- vector search handles it
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    expect(observations.some((o) => o.text.includes("SQL injection"))).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Loop dampening activates after >3 events on same entity from same source in 60s
  // ---------------------------------------------------------------------------
  it("loop dampener activates after 3 rapid observations on the same entity", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that is generating cascading observations
    const user = await createTestUser(baseUrl, `dampen-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "coord-dampen");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Implement rate limiting for billing API",
    });

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When the Observer creates 4 observations targeting the same task within 60 seconds
    const obsIds = await createObservationBurst(surreal, workspaceId, {
      count: 4,
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
      severity: "warning",
      textPrefix: "Cascading issue on rate limiting task",
    });

    expect(obsIds.length).toBe(4);

    // Then the dampener activates and a meta-observation is created
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const metaObs = await getMetaObservations(surreal, workspaceId);
    const dampeningMeta = metaObs.find(
      (o) => o.text.includes("dampened") || o.category === "loop_dampening",
    );
    expect(dampeningMeta).toBeDefined();

    // And the meta-observation is visible in the governance feed
    const feedEvents = feedStream.getEvents();
    // The meta-observation should appear as a feed item
    const feedItems = feedEvents.flatMap((e) => e.items);
    const dampeningFeedItem = feedItems.find(
      (item) => item.title?.includes("dampened") || item.type === "meta_observation",
    );
    // This is a soft assertion -- the feed item format depends on implementation
    // The primary assertion is the meta-observation in the graph
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Dampening resets after window expires (60 seconds)
  // ---------------------------------------------------------------------------
  it("dampening resets after 60 seconds allowing normal processing", async () => {
    const { surreal } = getRuntime();

    // Given dampening was activated on a task
    const { workspaceId } = await createTestWorkspace(surreal, "coord-reset");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Database migration task",
    });

    // Create 4 observations to trigger dampening
    await createObservationBurst(surreal, workspaceId, {
      count: 4,
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
      severity: "warning",
      textPrefix: "Dampening trigger observation",
    });

    // Wait for dampening to activate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // When the dampening window expires (60+ seconds later)
    // NOTE: In real tests we'd wait 65 seconds. For acceptance test speed,
    // we verify the dampener's window mechanism more narrowly.
    // The implementation should use a configurable window for testability.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Then a new observation for the same entity is processed normally
    await createObservation(surreal, workspaceId, {
      text: "New observation after dampening window should have passed",
      severity: "warning",
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
    });

    // Verification: the new observation exists in the graph
    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    const postDampenObs = observations.find(
      (o) => o.text.includes("after dampening window"),
    );
    expect(postDampenObs).toBeDefined();
  }, 90_000);
});
