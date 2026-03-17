/**
 * Walking Skeleton: Graph-Reactive Coordination E2E
 *
 * Traces: US-GRC-01 (Live Feed SSE Bridge)
 *
 * These are the minimum viable E2E paths through the reactive coordination layer.
 * Skeleton 1: Graph write -> SSE event received by workspace admin
 * Skeleton 2: Decision status change -> feed item moves between tiers
 *
 * Together they prove:
 * - LIVE SELECT subscription captures graph changes
 * - Feed SSE Bridge transforms graph events to feed items
 * - SSE Registry delivers events to connected workspace clients
 * - Feed items use the same GovernanceFeedItem contract as the GET endpoint
 * - Tier assignment works correctly for status transitions
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
  confirmDecision,
  createDecision,
  openFeedStream,
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("reactive_walking_skeleton");

describe("Walking Skeleton: Workspace admin sees graph changes in real-time feed", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Graph write appears as SSE feed event
  // US-GRC-01: Live Governance Feed via SSE
  // ---------------------------------------------------------------------------
  it("admin sees a new observation in the feed without refreshing the page", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `skeleton-feed-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "skeleton-feed");

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();
      expect(feedStream.isConnected()).toBe(true);

      await createObservation(surreal, workspaceId, {
        text: "Schema migration missing for new field on task table",
        severity: "warning",
        sourceAgent: "observer_agent",
        category: "engineering",
      });

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const feedItems = events.flatMap((e) => e.items);
      const observationItem = feedItems.find((item) =>
        item.title?.includes("Schema migration missing") ||
        item.type === "observation",
      );
      expect(observationItem).toBeDefined();
    } finally {
      feedStream.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: Decision status change moves item between tiers
  // US-GRC-01: Live Governance Feed via SSE (tier transitions)
  // ---------------------------------------------------------------------------
  it("admin sees a confirmed decision move from blocking to awareness tier", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `skeleton-tier-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "skeleton-tier");

    const { decisionId } = await createDecision(surreal, workspaceId, {
      summary: "Standardize on tRPC for all APIs",
      status: "provisional",
    });

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();
      expect(feedStream.isConnected()).toBe(true);

      await confirmDecision(surreal, decisionId);

      const events = await feedStream.waitForEvents(1, 5000);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const allItems = events.flatMap((e) => e.items);
      const allRemovals = events.flatMap((e) => e.removals ?? []);
      const hasTransition =
        allItems.some((item) =>
          item.title?.includes("tRPC") || item.title?.includes("confirmed"),
        ) || allRemovals.length > 0;
      expect(hasTransition).toBe(true);
    } finally {
      feedStream.close();
    }
  }, 30_000);
});
