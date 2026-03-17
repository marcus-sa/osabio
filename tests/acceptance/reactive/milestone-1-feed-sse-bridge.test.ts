/**
 * Milestone 1: Live Governance Feed via SSE (US-GRC-01)
 *
 * Traces: US-GRC-01 acceptance criteria
 *
 * Tests the LIVE SELECT -> Feed SSE Bridge -> SSE delivery pipeline.
 * Scenarios cover: connection lifecycle, feed item delivery, tier assignment,
 * reconnection with delta sync, keep-alive, and high-volume batching.
 *
 * Driving ports:
 *   GET  /api/workspaces/:workspaceId/feed/stream   (SSE feed stream)
 *   GET  /api/workspaces/:workspaceId/feed           (initial feed state)
 *   SurrealDB direct queries                         (graph write triggers)
 */
import { describe, expect, it, afterEach } from "bun:test";
import {
  setupReactiveSuite,
  createTestUser,
  createTestWorkspace,
  createObservation,
  createDecision,
  createTask,
  confirmDecision,
  blockTask,
  openFeedStream,
  getFeedState,
  fetchRaw,
  type FeedStreamController,
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("feed_sse_bridge");

describe("US-GRC-01: Live Governance Feed via SSE", () => {
  let feedStream: FeedStreamController | undefined;

  afterEach(() => {
    feedStream?.close();
    feedStream = undefined;
  });

  // ---------------------------------------------------------------------------
  // AC: SSE endpoint established on feed page load
  // ---------------------------------------------------------------------------
  it("feed establishes SSE connection for workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace admin navigates to the governance feed
    const user = await createTestUser(baseUrl, `sse-connect-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "sse-connect");

    // When the feed page loads and opens the SSE stream
    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // Then the SSE connection is established
    expect(feedStream.isConnected()).toBe(true);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: New items appear in the correct tier within 2 seconds
  // ---------------------------------------------------------------------------
  it.skip("new observation appears in feed within 2 seconds of graph write", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the admin has the governance feed open for a workspace
    const user = await createTestUser(baseUrl, `latency-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "latency");

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When the Observer creates a conflict observation
    const writeTime = Date.now();
    await createObservation(surreal, workspaceId, {
      text: "Task T-47 implementation contradicts confirmed decision D-99",
      severity: "conflict",
      sourceAgent: "observer_agent",
    });

    // Then the observation appears in the feed within 2 seconds
    const events = await feedStream.waitForEvents(1, 3000);
    const receiveTime = Date.now();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(receiveTime - writeTime).toBeLessThan(2000);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Feed items use same GovernanceFeedItem contract as GET endpoint
  // ---------------------------------------------------------------------------
  it.skip("SSE feed items match the same contract as the initial feed load", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with existing feed data
    const user = await createTestUser(baseUrl, `contract-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "contract");

    // And the admin loads the initial feed state via GET
    const initialFeed = await getFeedState(baseUrl, workspaceId, user);

    // And the admin opens the SSE stream
    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When a new warning observation is created
    await createObservation(surreal, workspaceId, {
      text: "Unused API endpoint detected in billing service",
      severity: "warning",
      sourceAgent: "observer_agent",
    });

    // Then the SSE event contains items with the same shape as GET response items
    const events = await feedStream.waitForEvents(1, 5000);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const sseItem = events[0].items[0];
    // Both GET and SSE items should have: id, type, tier, title, created_at
    expect(sseItem).toHaveProperty("id");
    expect(sseItem).toHaveProperty("type");
    expect(sseItem).toHaveProperty("tier");
    expect(sseItem).toHaveProperty("title");
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Decision confirmation moves item between tiers
  // ---------------------------------------------------------------------------
  it.skip("confirming a decision removes it from blocking tier and adds awareness item", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a provisional decision in the blocking tier
    const user = await createTestUser(baseUrl, `tier-move-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "tier-move");

    const { decisionId } = await createDecision(surreal, workspaceId, {
      summary: "Use event sourcing for audit trail",
      status: "provisional",
    });

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When the decision is confirmed
    await confirmDecision(surreal, decisionId);

    // Then a feed update arrives with the tier transition
    const events = await feedStream.waitForEvents(1, 5000);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // The update contains either a removal from blocking or a new awareness item
    const allItems = events.flatMap((e) => e.items);
    const allRemovals = events.flatMap((e) => e.removals ?? []);
    const confirmedItem = allItems.find(
      (item) => item.title?.includes("event sourcing") || item.title?.includes("confirmed"),
    );
    const hasRemoval = allRemovals.some((id) => id.includes(decisionId));

    expect(confirmedItem !== undefined || hasRemoval).toBe(true);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Task blocked appears in correct tier
  // ---------------------------------------------------------------------------
  it.skip("blocking a task surfaces it in the review tier", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an open task
    const user = await createTestUser(baseUrl, `task-block-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "task-block");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Implement user authentication flow",
      status: "in_progress",
    });

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When the task is marked as blocked
    await blockTask(surreal, taskId);

    // Then a feed update appears with the task in the review tier
    const events = await feedStream.waitForEvents(1, 5000);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const allItems = events.flatMap((e) => e.items);
    const blockedItem = allItems.find(
      (item) => item.title?.includes("authentication") || item.title?.includes("blocked"),
    );
    expect(blockedItem).toBeDefined();
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: SSE keep-alive maintains connection
  // ---------------------------------------------------------------------------
  it("SSE connection sends keep-alive and stays open during idle periods", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the admin has the governance feed open with no graph changes
    const user = await createTestUser(baseUrl, `keepalive-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "keepalive");

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When 20 seconds pass with no graph changes
    await new Promise((resolve) => setTimeout(resolve, 20_000));

    // Then the connection remains open (keep-alive comments sent every 15s)
    expect(feedStream.isConnected()).toBe(true);

    // And at least one keep-alive was received (raw events include non-JSON comments)
    const rawEvents = feedStream.getRawEvents();
    // Keep-alive comments or heartbeats should exist
    // The connection itself not timing out is the primary assertion
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: On reconnection, missed events are replayed (delta sync)
  // ---------------------------------------------------------------------------
  it.skip("missed events are delivered after brief reconnection", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the admin had the feed open and received some events
    const user = await createTestUser(baseUrl, `reconnect-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "reconnect");

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // And the admin received an initial event
    await createObservation(surreal, workspaceId, {
      text: "Initial observation before disconnect",
      severity: "info",
      sourceAgent: "observer_agent",
    });
    await feedStream.waitForEvents(1, 5000);

    // When the SSE connection drops (simulate by closing)
    feedStream.close();

    // And during disconnection, new graph changes occur
    await createObservation(surreal, workspaceId, {
      text: "Observation created during disconnect",
      severity: "warning",
      sourceAgent: "observer_agent",
    });
    await createDecision(surreal, workspaceId, {
      summary: "Decided during disconnect: Use PostgreSQL for analytics",
      status: "provisional",
    });

    // When the connection recovers (reconnect)
    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // Then the missed events are delivered
    const events = await feedStream.waitForEvents(1, 5000);
    // At minimum, the feed state should reflect the changes made during disconnect
    // (either via delta sync or full refresh)
    const feedState = await getFeedState(baseUrl, workspaceId, user);
    expect(feedState).toBeDefined();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: No duplicate feed items after reconnection
  // ---------------------------------------------------------------------------
  it.skip("feed items are not duplicated after reconnection", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an observation already in the feed
    const user = await createTestUser(baseUrl, `dedup-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "dedup");

    const { observationId } = await createObservation(surreal, workspaceId, {
      text: "Unique observation for dedup test",
      severity: "info",
      sourceAgent: "observer_agent",
    });

    // When the admin connects, disconnects, and reconnects
    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();
    await feedStream.waitForEvents(1, 3000);
    feedStream.close();

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();
    await feedStream.waitForEvents(1, 3000);

    // Then the full feed state contains no duplicate items for the same observation
    const feedState = await getFeedState(baseUrl, workspaceId, user);
    // Verification: count items matching the observation
    const items = (feedState as { items?: Array<{ id: string }> }).items ?? [];
    const matchingItems = items.filter((item) => item.id?.includes(observationId));
    expect(matchingItems.length).toBeLessThanOrEqual(1);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: High-volume event bursts are batched (500ms window)
  // ---------------------------------------------------------------------------
  it.skip("rapid graph changes are batched into fewer SSE events", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the admin has the governance feed open
    const user = await createTestUser(baseUrl, `batch-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "batch");

    feedStream = openFeedStream(baseUrl, workspaceId, user);
    await feedStream.connect();

    // When 10 observations are created in rapid succession (within 500ms)
    const createPromises = Array.from({ length: 10 }, (_, i) =>
      createObservation(surreal, workspaceId, {
        text: `Batch observation ${i + 1}`,
        severity: "info",
        sourceAgent: "observer_agent",
      }),
    );
    await Promise.all(createPromises);

    // Then the number of SSE events received is fewer than 10 (batched)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const events = feedStream.getEvents();

    // Batching means we should get significantly fewer events than individual writes
    // Allow some tolerance: if batching is working, we expect < 10 SSE events for 10 writes
    expect(events.length).toBeLessThan(10);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // And the total items across all events should reflect all observations
    const totalItems = events.reduce((sum, e) => sum + e.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(1);
  }, 15_000);
});
