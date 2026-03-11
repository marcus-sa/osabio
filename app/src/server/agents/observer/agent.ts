/**
 * Observer agent: verifies entity state changes and surfaces observations.
 *
 * Follows the same structural pattern as agents/pm/agent.ts.
 * Currently operates deterministically using the verification pipeline.
 * Future milestones may introduce LLM-based reasoning via ToolLoopAgent.
 *
 * Pipeline: receive event -> load workspace context -> verify claim vs reality -> create observation
 */

import { RecordId, type Surreal } from "surrealdb";
import { createObservation } from "../../observation/queries";
import { listWorkspaceOpenObservations } from "../../observation/queries";
import { gatherTaskSignals } from "../../observer/external-signals";
import { compareTaskCompletion, type VerificationResult } from "../../observer/verification-pipeline";
import { buildObserverSystemPrompt } from "./prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObserverVerdict = "match" | "mismatch" | "inconclusive";

export type ObserverAgentOutput = {
  observations_created: number;
  verdict: ObserverVerdict;
  evidence: string[];
};

export type ObserverAgentInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  entityTable: string;
  entityId: string;
  entityBody?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

export async function runObserverAgent(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityTable, entityId } = input;

  // Load workspace context (satisfies S5-2: considers existing observations)
  const _systemPrompt = await buildObserverSystemPrompt({
    surreal,
    workspaceRecord,
  });

  // Load existing observations to inform analysis
  const existingObservations = await listWorkspaceOpenObservations({
    surreal,
    workspaceRecord,
    limit: 30,
  });

  // Dispatch to entity-specific verification
  switch (entityTable) {
    case "task":
      return verifyTaskCompletion(surreal, workspaceRecord, entityId, existingObservations);
    default:
      return {
        observations_created: 0,
        verdict: "inconclusive",
        evidence: [`Entity type '${entityTable}' verification not yet implemented`],
      };
  }
}

// ---------------------------------------------------------------------------
// Task verification
// ---------------------------------------------------------------------------

async function verifyTaskCompletion(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  taskId: string,
  _existingObservations: Awaited<ReturnType<typeof listWorkspaceOpenObservations>>,
): Promise<ObserverAgentOutput> {
  const taskRecord = new RecordId("task", taskId);
  const evidence: string[] = [];

  // Gather external signals (commits, CI)
  const signalsResult = await gatherTaskSignals(surreal, taskId);
  evidence.push(`Commits found: ${signalsResult.hasCommits}`);
  evidence.push(`Signal count: ${signalsResult.signals.length}`);

  // Run pure comparison
  const verificationResult = compareTaskCompletion(signalsResult);
  evidence.push(`Verdict: ${verificationResult.verdict}`);
  evidence.push(verificationResult.text);

  // Persist observation with observes edge
  await persistVerificationObservation(
    surreal,
    workspaceRecord,
    taskRecord,
    verificationResult,
  );

  return {
    observations_created: 1,
    verdict: verificationResult.verdict,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Observation persistence
// ---------------------------------------------------------------------------

async function persistVerificationObservation(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  relatedRecord: RecordId,
  verificationResult: VerificationResult,
): Promise<void> {
  const now = new Date();

  const observationRecord = await createObservation({
    surreal,
    workspaceRecord,
    text: verificationResult.text,
    severity: verificationResult.severity,
    sourceAgent: "observer_agent",
    observationType: "validation",
    now,
    relatedRecord: relatedRecord as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
  });

  // Set verified and source fields
  await surreal.query(
    `UPDATE $obs SET verified = $verified, source = $source;`,
    {
      obs: observationRecord,
      verified: verificationResult.verified,
      source: verificationResult.source ?? "none",
    },
  );
}
