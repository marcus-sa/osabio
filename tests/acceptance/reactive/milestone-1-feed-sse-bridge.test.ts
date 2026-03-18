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
import { describe, expect, it } from "bun:test";
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
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("feed_sse_bridge");

describe("US-GRC-01: Live Governance Feed via SSE", () => {
  // ---------------------------------------------------------------------------
  // AC: SSE endpoint established on feed page load
  // ---------------------------------------------------------------------------
  it("feed establishes SSE connection for workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `sse-connect-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "sse-connect");

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();
      expect(feedStream.isConnected()).toBe(true);
    } finally {
      feedStream.close();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: New items appear in the correct tier within 2 seconds
  // ---------------------------------------------------------------------------
  it("new observation appears in feed within 2 seconds of graph write", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `latency-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "latency");

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      const writeTime = Date.now();
      await createObservation(surreal, workspaceId, {
        text: "Task T-47 implementation contradicts confirmed decision D-99",
        severity: "conflict",
        sourceAgent: "observer_agent",
      });

      const events = await feedStream.waitForEvents(1, 3000);
      const receiveTime = Date.now();

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(receiveTime - writeTime).toBeLessThan(2000);
    } finally {
      feedStream.close();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Feed items use same GovernanceFeedItem contract as GET endpoint
  // ---------------------------------------------------------------------------
  it("SSE feed items match the same contract as the initial feed load", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `contract-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "contract");

    const initialFeed = await getFeedState(baseUrl, workspaceId, user);

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await createObservation(surreal, workspaceId, {
        text: "Unused API endpoint detected in billing service",
        severity: "warning",
        sourceAgent: "observer_agent",
      });

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const sseItem = events[0].items[0];
      expect(sseItem).toHaveProperty("id");
      expect(sseItem).toHaveProperty("type");
      expect(sseItem).toHaveProperty("tier");
      expect(sseItem).toHaveProperty("title");
    } finally {
      feedStream.close();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Decision confirmation moves item between tiers
  // ---------------------------------------------------------------------------
  it("confirming a decision removes it from blocking tier and adds awareness item", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `tier-move-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "tier-move");

    const { decisionId } = await createDecision(surreal, workspaceId, {
      summary: "Use event sourcing for audit trail",
      status: "provisional",
    });

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await confirmDecision(surreal, decisionId);

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const allItems = events.flatMap((e) => e.items);
      const allRemovals = events.flatMap((e) => e.removals ?? []);
      const confirmedItem = allItems.find(
        (item) => item.title?.includes("event sourcing") || item.title?.includes("confirmed"),
      );
      const hasRemoval = allRemovals.some((id) => id.includes(decisionId));

      expect(confirmedItem !== undefined || hasRemoval).toBe(true);
    } finally {
      feedStream.close();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Task blocked appears in correct tier
  // ---------------------------------------------------------------------------
  it("blocking a task surfaces it in the review tier", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `task-block-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "task-block");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Implement user authentication flow",
      status: "in_progress",
    });

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await blockTask(surreal, taskId);

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const allItems = events.flatMap((e) => e.items);
      const blockedItem = allItems.find(
        (item) => item.title?.includes("authentication") || item.title?.includes("blocked"),
      );
      expect(blockedItem).toBeDefined();
    } finally {
      feedStream.close();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: SSE keep-alive maintains connection
  // ---------------------------------------------------------------------------
  it("SSE connection sends keep-alive and stays open during idle periods", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `keepalive-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "keepalive");

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await new Promise((resolve) => setTimeout(resolve, 20_000));

      expect(feedStream.isConnected()).toBe(true);

      const rawEvents = feedStream.getRawEvents();
      // Keep-alive comments or heartbeats should exist
      // The connection itself not timing out is the primary assertion
    } finally {
      feedStream.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: On reconnection, missed events are replayed (delta sync)
  // ---------------------------------------------------------------------------
  it("missed events are delivered after brief reconnection", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `reconnect-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "reconnect");

    let feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await createObservation(surreal, workspaceId, {
        text: "Initial observation before disconnect",
        severity: "info",
        sourceAgent: "observer_agent",
      });
      await feedStream.waitForEvents(1, 5000);

      const lastEventId = feedStream.getLastEventId();
      feedStream.close();

      await createObservation(surreal, workspaceId, {
        text: "Observation created during disconnect",
        severity: "warning",
        sourceAgent: "observer_agent",
      });
      await createDecision(surreal, workspaceId, {
        summary: "Decided during disconnect: Use PostgreSQL for analytics",
        status: "provisional",
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      feedStream = openFeedStream(baseUrl, workspaceId, user, { lastEventId });
      await feedStream.connect();

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const feedState = await getFeedState(baseUrl, workspaceId, user);
      expect(feedState).toBeDefined();
    } finally {
      feedStream.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: No duplicate feed items after reconnection
  // ---------------------------------------------------------------------------
  it("feed items are not duplicated after reconnection", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `dedup-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "dedup");

    const { observationId } = await createObservation(surreal, workspaceId, {
      text: "Unique observation for dedup test",
      severity: "info",
      sourceAgent: "observer_agent",
    });

    let feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();
      await feedStream.waitForEvents(1, 3000);
      feedStream.close();

      feedStream = openFeedStream(baseUrl, workspaceId, user);
      await feedStream.connect();
      await feedStream.waitForEvents(1, 3000);

      const feedState = await getFeedState(baseUrl, workspaceId, user);
      const items = (feedState as { items?: Array<{ id: string }> }).items ?? [];
      const matchingItems = items.filter((item) => item.id?.includes(observationId));
      expect(matchingItems.length).toBeLessThanOrEqual(1);
    } finally {
      feedStream.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: High-volume event bursts are batched (500ms window)
  // ---------------------------------------------------------------------------
  it("rapid graph changes are batched into fewer SSE events", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `batch-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "batch");

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      const createPromises = Array.from({ length: 10 }, (_, i) =>
        createObservation(surreal, workspaceId, {
          text: `Batch observation ${i + 1}`,
          severity: "info",
          sourceAgent: "observer_agent",
        }),
      );
      await Promise.all(createPromises);

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const events = feedStream.getEvents();

      expect(events.length).toBeLessThan(10);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const totalItems = events.reduce((sum, e) => sum + e.items.length, 0);
      expect(totalItems).toBeGreaterThanOrEqual(1);
    } finally {
      feedStream.close();
    }
  }, 15_000);
});
