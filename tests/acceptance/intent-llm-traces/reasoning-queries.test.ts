/**
 * Step 03: Reasoning Queries and API Access Control
 *
 * Traces: US-03 (View Logic UI Toggle), US-04 (Observer Reasoning Queries)
 *
 * Validates that:
 * - listObservationsWithReasoning() returns only observations that have reasoning
 * - Query respects workspace scope and configurable limits
 * - Query supports time-range filtering
 * - API includes reasoning for admin users only
 * - Non-admin API responses omit reasoning field entirely
 *
 * Driving ports:
 *   listObservationsWithReasoning()   — query function
 *   GET /api/workspaces/:ws/observer/observations — API endpoint
 *   Direct DB for query validation
 *
 * Error path ratio: 6/14 = 43%
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupReasoningSuite,
  setupReasoningWorkspace,
  createObservationWithReasoning,
  createDeterministicObservation,
  listObservationsWithReasoning,
  listObservationsWithoutReasoning,
  fetchObservationsApi,
} from "./reasoning-test-kit";

const getRuntime = setupReasoningSuite("reasoning_queries_step03");

// =============================================================================
// Walking Skeleton: Admin reviews observer reasoning behind its findings
// =============================================================================

describe("Walking Skeleton: Admin inspects the reasoning behind observer findings", () => {
  // @walking_skeleton
  it("admin queries observations and sees the reasoning that explains each finding", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer has created findings with reasoning
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "ws-skel-query");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Task completion claim does not match code changes",
      severity: "conflict",
      sourceAgent: "observer_agent",
      reasoning: "The commit modifies auth code but the task is about rate limiting. Mismatch detected.",
      observationType: "validation",
    });

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Decision conflict between REST and tRPC standards",
      severity: "conflict",
      sourceAgent: "observer_agent",
      reasoning: "Two confirmed decisions mandate different API protocols for the same endpoint.",
      observationType: "contradiction",
    });

    await createDeterministicObservation(surreal, workspaceId, {
      text: "Task stale for 14 days",
      severity: "warning",
      sourceAgent: "observer_agent",
    });

    // When the admin queries for observations with reasoning
    const withReasoning = await listObservationsWithReasoning(surreal, workspaceId);

    // Then only the LLM-verified findings appear (not the deterministic one)
    expect(withReasoning).toHaveLength(2);
    expect(withReasoning.every((obs) => obs.reasoning !== undefined)).toBe(true);
    expect(withReasoning.some((obs) => obs.text.includes("Task completion claim"))).toBe(true);
    expect(withReasoning.some((obs) => obs.text.includes("Decision conflict"))).toBe(true);
  }, 30_000);
});

// =============================================================================
// Happy Path: Query function behavior
// =============================================================================

describe("Step 03: listObservationsWithReasoning query function", () => {
  // ---------------------------------------------------------------------------
  // S03-1: Returns only observations with reasoning
  // ---------------------------------------------------------------------------
  it("returns observations that have reasoning and excludes those without", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a mix of LLM-analyzed and deterministic observations
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-filter");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "LLM-verified finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Analysis shows this pattern is benign",
    });

    await createDeterministicObservation(surreal, workspaceId, {
      text: "Rule-based finding",
      severity: "warning",
      sourceAgent: "observer_agent",
    });

    // When querying for observations with reasoning
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then only the LLM-verified observation is returned
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("LLM-verified finding");
    expect(results[0].reasoning).toBe("Analysis shows this pattern is benign");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-2: Respects configurable limit
  // ---------------------------------------------------------------------------
  it("respects the configurable result limit", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given more observations with reasoning than the requested limit
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-limit");

    for (let i = 0; i < 5; i++) {
      await createObservationWithReasoning(surreal, workspaceId, {
        text: `Finding number ${i + 1}`,
        severity: "info",
        sourceAgent: "observer_agent",
        reasoning: `Reasoning for finding ${i + 1}`,
      });
    }

    // When querying with a limit of 3
    const results = await listObservationsWithReasoning(surreal, workspaceId, { limit: 3 });

    // Then only 3 results are returned
    expect(results).toHaveLength(3);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-3: Results are ordered by creation time descending
  // ---------------------------------------------------------------------------
  it("returns observations ordered by most recent first", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given observations created at different times
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-order");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "First finding (older)",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Earlier analysis",
    });

    // Small delay to ensure ordering
    await Bun.sleep(50);

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Second finding (newer)",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Later analysis",
    });

    // When querying observations with reasoning
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then the most recent observation comes first
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe("Second finding (newer)");
    expect(results[1].text).toBe("First finding (older)");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-4: Time range filtering
  // ---------------------------------------------------------------------------
  it("filters observations by time range when specified", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given observations created before and after a cutoff time
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-time");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Old finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Old analysis",
    });

    await Bun.sleep(100);
    const cutoff = new Date();
    await Bun.sleep(100);

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Recent finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Recent analysis",
    });

    // When querying with a time range starting after the cutoff
    const results = await listObservationsWithReasoning(surreal, workspaceId, { since: cutoff });

    // Then only the recent observation is returned
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("Recent finding");
  }, 30_000);
});

// =============================================================================
// Complementary query: observations without reasoning
// =============================================================================

describe("Step 03: listObservationsWithoutReasoning query function", () => {
  // ---------------------------------------------------------------------------
  // S03-5: Returns only deterministic observations
  // ---------------------------------------------------------------------------
  it("returns observations that have no reasoning (deterministic path)", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a mix of observations
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-no-reason");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "LLM finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "LLM analysis",
    });

    await createDeterministicObservation(surreal, workspaceId, {
      text: "Deterministic finding",
      severity: "warning",
      sourceAgent: "observer_agent",
    });

    // When querying for observations without reasoning
    const results = await listObservationsWithoutReasoning(surreal, workspaceId);

    // Then only the deterministic observation is returned
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("Deterministic finding");
    expect(results[0].reasoning).toBeUndefined();
  }, 30_000);
});

// =============================================================================
// Workspace Scope Enforcement
// =============================================================================

describe("Step 03: Workspace scope enforcement", () => {
  // ---------------------------------------------------------------------------
  // S03-6: Observations from other workspaces are excluded
  // ---------------------------------------------------------------------------
  it("observations from a different workspace are not returned", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given two workspaces each with their own observations
    const { workspaceId: ws1 } = await setupReasoningWorkspace(baseUrl, surreal, "scope-ws1");
    const { workspaceId: ws2 } = await setupReasoningWorkspace(baseUrl, surreal, "scope-ws2");

    await createObservationWithReasoning(surreal, ws1, {
      text: "Workspace 1 finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Analysis in workspace 1",
    });

    await createObservationWithReasoning(surreal, ws2, {
      text: "Workspace 2 finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Analysis in workspace 2",
    });

    // When querying workspace 1
    const results = await listObservationsWithReasoning(surreal, ws1);

    // Then only workspace 1's observation is returned
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("Workspace 1 finding");
  }, 30_000);
});

// =============================================================================
// Error / Edge Cases
// =============================================================================

describe("Step 03: Error and edge cases for reasoning queries", () => {
  // ---------------------------------------------------------------------------
  // S03-7: Empty workspace returns empty results
  // ---------------------------------------------------------------------------
  it("returns empty results for a workspace with no observations", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with no observations at all
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-empty");

    // When querying for observations with reasoning
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then the result is an empty list
    expect(results).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-8: Workspace with only deterministic observations returns empty
  // ---------------------------------------------------------------------------
  it("returns empty results when workspace has only deterministic observations", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with only rule-based observations (no LLM reasoning)
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-determ-only");

    await createDeterministicObservation(surreal, workspaceId, {
      text: "Deterministic finding A",
      severity: "info",
      sourceAgent: "observer_agent",
    });

    await createDeterministicObservation(surreal, workspaceId, {
      text: "Deterministic finding B",
      severity: "warning",
      sourceAgent: "observer_agent",
    });

    // When querying for observations with reasoning
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then no results are returned
    expect(results).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-9: Limit of zero returns no results
  // ---------------------------------------------------------------------------
  it("limit of zero returns no results even when observations exist", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-limit-zero");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Some finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Some reasoning",
    });

    // When querying with limit 0
    const results = await listObservationsWithReasoning(surreal, workspaceId, { limit: 0 });

    // Then no results are returned
    expect(results).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-10: Future since date returns empty results
  // ---------------------------------------------------------------------------
  it("time range in the future returns no results", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations created now
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-future");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Current finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Current analysis",
    });

    // When querying with a future cutoff date
    const futureDate = new Date(Date.now() + 86_400_000); // tomorrow
    const results = await listObservationsWithReasoning(surreal, workspaceId, { since: futureDate });

    // Then no results are returned
    expect(results).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-11: Default limit applies when not specified
  // ---------------------------------------------------------------------------
  it("applies a default limit when none is specified", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-default-limit");

    for (let i = 0; i < 3; i++) {
      await createObservationWithReasoning(surreal, workspaceId, {
        text: `Finding ${i + 1}`,
        severity: "info",
        sourceAgent: "observer_agent",
        reasoning: `Reasoning ${i + 1}`,
      });
    }

    // When querying without specifying a limit
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then all results within the default limit are returned
    expect(results).toHaveLength(3);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-12: Observations with empty-string reasoning ARE included
  // ---------------------------------------------------------------------------
  it("observations with empty-string reasoning are included in reasoning query", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given observations with empty and non-empty reasoning
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "query-empty-str");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Finding with empty reasoning",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "",
    });

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Finding with real reasoning",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Actual analysis",
    });

    // When querying for observations with reasoning
    const results = await listObservationsWithReasoning(surreal, workspaceId);

    // Then both are included (empty string is not NONE)
    expect(results).toHaveLength(2);
  }, 30_000);
});

// =============================================================================
// API Access Control (US-03)
// =============================================================================

describe("Step 03: API reasoning access control", () => {
  // ---------------------------------------------------------------------------
  // S03-13: Admin user sees reasoning in API response
  // US-03 requires implementation of admin role check -- skip until implemented
  // ---------------------------------------------------------------------------
  it.skip("admin user receives reasoning field in the observation API response", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations that have reasoning
    const { workspaceId, user } = await setupReasoningWorkspace(baseUrl, surreal, "api-admin");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Finding with reasoning",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "Admin-visible reasoning",
    });

    // When an admin requests observations with reasoning included
    const response = await fetchObservationsApi(baseUrl, workspaceId, user, { includeReasoning: true });

    // Then the response includes the reasoning field
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { observations: Array<{ reasoning?: string }> };
    expect(body.observations[0].reasoning).toBe("Admin-visible reasoning");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S03-14: Non-admin user does not see reasoning in API response
  // US-03 requires implementation of admin role check -- skip until implemented
  // ---------------------------------------------------------------------------
  it.skip("non-admin user receives observation API response without reasoning field", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations that have reasoning
    const { workspaceId, user } = await setupReasoningWorkspace(baseUrl, surreal, "api-nonadmin");

    await createObservationWithReasoning(surreal, workspaceId, {
      text: "Finding with hidden reasoning",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "This should not be visible",
    });

    // When a non-admin requests observations (without include_reasoning flag)
    const response = await fetchObservationsApi(baseUrl, workspaceId, user);

    // Then the response omits the reasoning field entirely
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { observations: Array<{ reasoning?: string }> };
    expect(body.observations[0].reasoning).toBeUndefined();
  }, 30_000);
});
