/**
 * Objective Progress Visibility Acceptance Tests (US-OB-05)
 *
 * Validates that objective progress can be computed from supporting
 * intents and success criteria, and that inactive/expired objectives
 * are properly flagged.
 *
 * Driving ports:
 *   GET /api/workspaces/:workspaceId/objectives/:id/progress  (progress view)
 *   GET /api/workspaces/:workspaceId/objectives?status=expired (expired filter)
 *   SurrealDB direct queries                                   (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupObjectiveBehaviorSuite,
  setupObjectiveWorkspace,
  createAgentIdentity,
  createObjective,
  createIntent,
  createSupportsEdge,
} from "./objective-behavior-test-kit";

const getRuntime = setupObjectiveBehaviorSuite("objective_progress");

// ---------------------------------------------------------------------------
// Helper: fetch progress through the HTTP driving port
// ---------------------------------------------------------------------------

async function fetchObjectiveProgress(
  baseUrl: string,
  workspaceId: string,
  objectiveId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/objectives/${objectiveId}/progress`,
  );
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

// =============================================================================
// Walking Skeleton: Leader views objective with supporting intents
// =============================================================================
describe("Walking Skeleton: Objective progress from supporting intents (US-OB-05)", () => {
  it("objective shows correct count of supporting intents", async () => {
    const { surreal, baseUrl } = getRuntime();

    // Given objective "Launch MCP Marketplace" exists
    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-progress-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Launch MCP Marketplace",
      status: "active",
      target_date: "2026-06-30",
      success_criteria: [
        { metric_name: "listed_integrations", target_value: 10, current_value: 3, unit: "count" },
      ],
    });

    // And multiple agents have submitted aligned intents
    const { identityId: agentAlpha } = await createAgentIdentity(surreal, workspaceId, "Coder-Alpha");
    const { identityId: agentBeta } = await createAgentIdentity(surreal, workspaceId, "Coder-Beta");

    for (let i = 0; i < 5; i++) {
      const { intentId } = await createIntent(surreal, workspaceId, agentAlpha, {
        goal: `Implement MCP integration feature ${i + 1}`,
      });
      await createSupportsEdge(surreal, intentId, objectiveId, { alignment_score: 0.85 });
    }
    for (let i = 0; i < 3; i++) {
      const { intentId } = await createIntent(surreal, workspaceId, agentBeta, {
        goal: `Build MCP marketplace UI component ${i + 1}`,
      });
      await createSupportsEdge(surreal, intentId, objectiveId, { alignment_score: 0.78 });
    }

    // When Elena views the objective progress via HTTP endpoint
    const { status, body } = await fetchObjectiveProgress(baseUrl, workspaceId, objectiveId);

    // Then the response is successful
    expect(status).toBe(200);

    // And the objective has 8 supporting intents
    const progress = body.progress as Record<string, unknown>;
    expect(progress.supporting_intent_count).toBe(8);

    // And the success criteria show current progress
    const criteria = progress.success_criteria as Array<Record<string, unknown>>;
    expect(criteria[0].metric_name).toBe("listed_integrations");
    expect(criteria[0].current_value).toBe(3);
    expect(criteria[0].target_value).toBe(10);

    // And the objective is not expired
    expect(progress.is_expired).toBe(false);
  }, 60_000);
});

// =============================================================================
// Happy Path: Success criteria tracking
// =============================================================================
describe("Happy Path: Key result tracking on objective (US-OB-05)", () => {
  it("success criteria track current versus target values", async () => {
    const { surreal, baseUrl } = getRuntime();

    // Given an objective with multiple key results
    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-kr-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Improve Infrastructure Reliability",
      status: "active",
      success_criteria: [
        { metric_name: "uptime", target_value: 99.9, current_value: 99.2, unit: "percent" },
        { metric_name: "error_rate", target_value: 0.1, current_value: 1.5, unit: "percent" },
      ],
    });

    // When Elena views the objective progress
    const { status, body } = await fetchObjectiveProgress(baseUrl, workspaceId, objectiveId);

    // Then she sees progress on each key result
    expect(status).toBe(200);
    const progress = body.progress as Record<string, unknown>;
    const criteria = progress.success_criteria as Array<Record<string, unknown>>;

    const uptime = criteria.find((sc) => sc.metric_name === "uptime");
    expect(uptime!.current_value).toBe(99.2);
    expect(uptime!.target_value).toBe(99.9);

    const errorRate = criteria.find((sc) => sc.metric_name === "error_rate");
    expect(errorRate!.current_value).toBe(1.5);
    expect(errorRate!.target_value).toBe(0.1);
  }, 60_000);
});

// =============================================================================
// Edge / Error Scenarios
// =============================================================================
describe("Edge Case: Objective with no recent activity (US-OB-05)", () => {
  it("objective with zero supporting intents is identifiable as unsupported", async () => {
    const { surreal, baseUrl } = getRuntime();

    // Given an objective with no supporting intents
    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-inactive-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Improve Infrastructure Reliability",
      status: "active",
    });

    // When checking progress via HTTP endpoint
    const { status, body } = await fetchObjectiveProgress(baseUrl, workspaceId, objectiveId);

    // Then zero supporting intents are found
    expect(status).toBe(200);
    const progress = body.progress as Record<string, unknown>;
    expect(progress.supporting_intent_count).toBe(0);
    expect(progress.is_unsupported).toBe(true);
  }, 60_000);
});

describe("Boundary: Expired objective detected by target date (US-OB-05)", () => {
  it("objective with past target date is detected as expired", async () => {
    const { surreal, baseUrl } = getRuntime();

    // Given an objective with a target date in the past
    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-expired-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Q1 Launch",
      status: "active",
      target_date: "2025-01-01",
    });

    // When viewing the objective progress
    const { status, body } = await fetchObjectiveProgress(baseUrl, workspaceId, objectiveId);

    // Then the objective is flagged as expired
    expect(status).toBe(200);
    const progress = body.progress as Record<string, unknown>;
    expect(progress.is_expired).toBe(true);
  }, 60_000);
});

describe("Boundary: Multiple objectives progress isolation (US-OB-05)", () => {
  it.skip("supporting intents are counted per objective, not globally", async () => {
    // Given two objectives exist
    // And 5 intents support objective A
    // And 3 intents support objective B
    // When viewing progress for each objective
    // Then objective A shows 5 supporting intents
    // And objective B shows 3 supporting intents
  });
});
