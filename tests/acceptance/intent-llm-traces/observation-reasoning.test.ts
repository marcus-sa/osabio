/**
 * Step 01: Observation Reasoning Persistence
 *
 * Traces: US-01 (Persist LLM Reasoning on Observations)
 *
 * Validates that:
 * - Observations can carry LLM reasoning text when created by verification paths
 * - Deterministic observations have no reasoning (field absent)
 * - Reasoning text is persisted and retrievable
 * - The reasoning field does not interfere with existing observation behavior
 *
 * Driving ports:
 *   createObservation() — observation query function (app/src/server/observation/queries.ts)
 *   Direct DB for schema validation
 *
 * Error path ratio: 5/11 = 45%
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupReasoningSuite,
  setupReasoningWorkspace,
  createObservationWithReasoning,
  createDeterministicObservation,
  getObservationRecord,
} from "./reasoning-test-kit";

const getRuntime = setupReasoningSuite("obs_reasoning_step01");

// =============================================================================
// Walking Skeleton: Observer records its reasoning when verifying a finding
// =============================================================================

describe("Walking Skeleton: Observer persists reasoning alongside its findings", () => {
  // @walking_skeleton
  it("observer creates a verified finding with reasoning explaining how it reached its conclusion", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer is monitoring activity
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "ws-skeleton-obs");

    // When the observer creates a finding after LLM verification with reasoning
    const reasoning = [
      "The task was marked completed on 2026-03-14.",
      "The linked commit sha-abc123 modifies src/auth/login.ts.",
      "The task description asks for rate limiting, but the commit only adds login validation.",
      "Conclusion: the task completion claim does not match the actual code change.",
    ].join(" ");

    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Task completion does not match the linked code change",
      severity: "conflict",
      sourceAgent: "observer_agent",
      reasoning,
      observationType: "validation",
      verified: true,
    });

    // Then the finding includes the reasoning that explains the observer's logic
    const record = await getObservationRecord(surreal, observationId);
    expect(record.text).toBe("Task completion does not match the linked code change");
    expect(record.reasoning).toBe(reasoning);
    expect(record.severity).toBe("conflict");
    expect(record.verified).toBe(true);
  }, 30_000);
});

// =============================================================================
// Happy Path: Reasoning persists from each observation source
// =============================================================================

describe("Step 01: Reasoning persists on observations from different sources", () => {
  // ---------------------------------------------------------------------------
  // S01-1: Verification verdict reasoning persists
  // ---------------------------------------------------------------------------
  it("verification verdict reasoning is stored on the observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with active observer monitoring
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-verify");

    // When the observer creates a finding from a verification verdict
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Task completion verified: code change matches task description",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "The commit adds input validation to the signup form, which matches the task goal of adding email format validation.",
      observationType: "validation",
      verified: true,
    });

    // Then the reasoning is retrievable from the observation
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toContain("commit adds input validation");
    expect(record.observation_type).toBe("validation");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-2: Peer review reasoning persists
  // ---------------------------------------------------------------------------
  it("peer review reasoning is stored on the observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer reviews another agent's finding
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-peer");

    // When the observer creates a peer review finding with its reasoning
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "PM agent's priority concern is valid but overstated",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "The PM agent flagged task priority as too low. Reviewing the deadline (2026-04-01) and current progress (70%), the risk exists but is manageable. Downgrading severity from warning to info.",
      observationType: "validation",
    });

    // Then the peer review reasoning is persisted
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toContain("Downgrading severity");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-3: Contradiction detection reasoning persists
  // ---------------------------------------------------------------------------
  it("contradiction detection reasoning is stored on the observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with decisions that may conflict
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-contradict");

    // When the observer detects a contradiction with reasoning
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Decision to use REST conflicts with decision to standardize on tRPC",
      severity: "conflict",
      sourceAgent: "observer_agent",
      reasoning: "Decision A (confirmed 2026-03-01) mandates tRPC for all new endpoints. Decision B (confirmed 2026-03-10) uses REST for the billing API. These are mutually exclusive for the billing endpoint. One must be revised.",
      observationType: "contradiction",
    });

    // Then the contradiction reasoning is stored
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toContain("mutually exclusive");
    expect(record.observation_type).toBe("contradiction");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-4: Anomaly evaluation reasoning persists
  // ---------------------------------------------------------------------------
  it("anomaly evaluation reasoning is stored on the observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer monitors patterns
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-anomaly");

    // When the observer flags an anomaly with its evaluation reasoning
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Unusually high number of task re-opens in the last 7 days",
      severity: "warning",
      sourceAgent: "observer_agent",
      reasoning: "8 tasks were re-opened in the past 7 days, compared to an average of 1.5 per week over the past month. This 5x increase suggests either unclear acceptance criteria or insufficient testing before completion.",
      observationType: "anomaly",
    });

    // Then the anomaly reasoning is stored
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toContain("5x increase");
  }, 30_000);
});

// =============================================================================
// Deterministic Path: No reasoning when observation is rule-based
// =============================================================================

describe("Step 01: Deterministic observations have no reasoning", () => {
  // ---------------------------------------------------------------------------
  // S01-5: Deterministic observation omits reasoning
  // ---------------------------------------------------------------------------
  it("observation from a deterministic rule has no reasoning field", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with deterministic monitoring rules
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-determ");

    // When a deterministic observation is created (no LLM involvement)
    const { observationId } = await createDeterministicObservation(surreal, workspaceId, {
      text: "Task has been in progress for more than 14 days",
      severity: "warning",
      sourceAgent: "observer_agent",
      observationType: "anomaly",
    });

    // Then the observation has no reasoning (field is absent)
    const record = await getObservationRecord(surreal, observationId);
    expect(record.text).toBe("Task has been in progress for more than 14 days");
    expect(record.reasoning).toBeUndefined();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-6: Chat agent observation omits reasoning
  // ---------------------------------------------------------------------------
  it("observation from the chat agent has no reasoning when created without LLM analysis", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with active chat conversations
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-chat");

    // When the chat agent creates an observation (user-triggered, no LLM reasoning)
    const { observationId } = await createDeterministicObservation(surreal, workspaceId, {
      text: "User flagged a potential risk with the deployment timeline",
      severity: "warning",
      sourceAgent: "chat_agent",
    });

    // Then the observation has no reasoning
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toBeUndefined();
    expect(record.source_agent).toBe("chat_agent");
  }, 30_000);
});

// =============================================================================
// Error / Edge Cases
// =============================================================================

describe("Step 01: Error and edge cases for observation reasoning", () => {
  // ---------------------------------------------------------------------------
  // S01-7: Empty reasoning string is stored as-is (not coerced)
  // ---------------------------------------------------------------------------
  it("empty reasoning string is preserved, not coerced to absent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-empty");

    // When an observation is created with an empty reasoning string
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Edge case observation",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "",
    });

    // Then the reasoning field is present but empty
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toBe("");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-8: Very long reasoning text persists without truncation
  // ---------------------------------------------------------------------------
  it("lengthy reasoning text from complex verification persists fully", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with complex verification scenarios
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-long");

    // When the observer creates a finding with extensive reasoning
    const longReasoning = Array.from({ length: 50 }, (_, i) =>
      `Step ${i + 1}: Verified condition ${i + 1} against the linked evidence.`,
    ).join(" ");

    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Complex multi-step verification completed",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: longReasoning,
    });

    // Then the full reasoning text is preserved
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toBe(longReasoning);
    expect(record.reasoning!.length).toBeGreaterThan(2000);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-9: Reasoning does not interfere with existing observation fields
  // ---------------------------------------------------------------------------
  it("adding reasoning does not affect existing observation fields", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-compat");

    // When an observation is created with reasoning alongside all existing fields
    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Compatibility test observation",
      severity: "conflict",
      sourceAgent: "observer_agent",
      reasoning: "This is a compatibility test reasoning",
      observationType: "contradiction",
      verified: true,
    });

    // Then all existing fields are preserved alongside reasoning
    const record = await getObservationRecord(surreal, observationId);
    expect(record.text).toBe("Compatibility test observation");
    expect(record.severity).toBe("conflict");
    expect(record.status).toBe("open");
    expect(record.source_agent).toBe("observer_agent");
    expect(record.observation_type).toBe("contradiction");
    expect(record.verified).toBe(true);
    expect(record.reasoning).toBe("This is a compatibility test reasoning");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-10: Reasoning with special characters persists correctly
  // ---------------------------------------------------------------------------
  it("reasoning containing quotes and special characters persists correctly", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-special");

    // When reasoning contains special characters from LLM output
    const reasoning = `The agent stated: "I need access to deploy." However, the policy says 'no deploy without approval'. Risk: medium (score: 45/100).`;

    const { observationId } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Agent request conflicts with deployment policy",
      severity: "warning",
      sourceAgent: "observer_agent",
      reasoning,
    });

    // Then the special characters are preserved
    const record = await getObservationRecord(surreal, observationId);
    expect(record.reasoning).toBe(reasoning);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S01-11: Multiple observations in same workspace have independent reasoning
  // ---------------------------------------------------------------------------
  it("multiple observations maintain independent reasoning in the same workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with multiple observer findings
    const { workspaceId } = await setupReasoningWorkspace(baseUrl, surreal, "obs-multi");

    // When multiple observations are created with different reasoning
    const { observationId: obs1Id } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "First finding",
      severity: "info",
      sourceAgent: "observer_agent",
      reasoning: "First reasoning chain",
    });

    const { observationId: obs2Id } = await createObservationWithReasoning(surreal, workspaceId, {
      text: "Second finding",
      severity: "warning",
      sourceAgent: "observer_agent",
      reasoning: "Second reasoning chain",
    });

    const { observationId: obs3Id } = await createDeterministicObservation(surreal, workspaceId, {
      text: "Third finding (deterministic)",
      severity: "info",
      sourceAgent: "observer_agent",
    });

    // Then each observation has its own independent reasoning (or lack thereof)
    const record1 = await getObservationRecord(surreal, obs1Id);
    const record2 = await getObservationRecord(surreal, obs2Id);
    const record3 = await getObservationRecord(surreal, obs3Id);

    expect(record1.reasoning).toBe("First reasoning chain");
    expect(record2.reasoning).toBe("Second reasoning chain");
    expect(record3.reasoning).toBeUndefined();
  }, 30_000);
});
