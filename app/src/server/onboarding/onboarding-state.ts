import { RecordId, type Surreal } from "surrealdb";
import type { OnboardingAction, OnboardingState } from "../../shared/contracts";

export type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
  description?: string;
  status: string;
  onboarding_complete: boolean;
  onboarding_turn_count: number;
  onboarding_summary_pending: boolean;
};

type OnboardingCounts = {
  projectCount: number;
  personCount: number;
  decisionCount: number;
  questionCount: number;
};

export function toOnboardingState(workspace: WorkspaceRow): OnboardingState {
  if (workspace.onboarding_complete) {
    return "complete";
  }
  if (workspace.onboarding_summary_pending) {
    return "summary_pending";
  }
  return "active";
}

export async function transitionOnboardingState(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  workspace: WorkspaceRow;
  onboardingAction?: OnboardingAction;
  now: Date;
}): Promise<OnboardingState> {
  if (input.workspace.onboarding_complete) {
    return "complete";
  }

  if (input.workspace.onboarding_summary_pending) {
    if (input.onboardingAction === "finalize_onboarding") {
      await input.surreal.update(input.workspaceRecord).merge({
        onboarding_complete: true,
        onboarding_summary_pending: false,
        onboarding_completed_at: input.now,
        updated_at: input.now,
      });
      return "complete";
    }

    return "summary_pending";
  }

  const counts = await loadOnboardingCounts(input.surreal, input.workspaceRecord);
  const minimumGraphReady =
    counts.projectCount >= 1 && counts.personCount >= 1 && counts.decisionCount + counts.questionCount >= 1;

  if (minimumGraphReady || input.workspace.onboarding_turn_count >= 7) {
    await input.surreal.update(input.workspaceRecord).merge({
      onboarding_summary_pending: true,
      updated_at: input.now,
    });
    return "summary_pending";
  }

  return "active";
}

async function loadOnboardingCounts(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<OnboardingCounts> {
  const [projectRows] = await surreal
    .query<[Array<{ id: RecordId<"project", string> }>]>(
      "SELECT id FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"project", string> }>]>() ;

  const [personRows] = await surreal
    .query<[Array<{ id: RecordId<"person", string> }>]>(
      "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"person", string> }>]>() ;

  const [decisionRows] = await surreal
    .query<[Array<{ id: RecordId<"decision", string> }>]>(
      [
        "SELECT id",
        "FROM decision",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ");",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId<"decision", string> }>]>() ;

  const [questionRows] = await surreal
    .query<[Array<{ id: RecordId<"question", string> }>]>(
      [
        "SELECT id",
        "FROM question",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ");",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId<"question", string> }>]>() ;

  return {
    projectCount: projectRows.length,
    personCount: personRows.length,
    decisionCount: decisionRows.length,
    questionCount: questionRows.length,
  };
}

export async function loadOnboardingSummary(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<string> {
  const workspace = await surreal.select<{ name: string; description?: string }>(workspaceRecord);

  const [projectRows] = await surreal
    .query<[Array<{ name: string }>]>(
      "SELECT name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace) LIMIT 8;",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ name: string }>]>() ;

  const [personRows] = await surreal
    .query<[Array<{ name: string }>]>(
      "SELECT name FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace) LIMIT 8;",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ name: string }>]>() ;

  const [decisionRows] = await surreal
    .query<[Array<{ summary: string; created_at: Date | string }>]>(
      [
        "SELECT summary, created_at",
        "FROM decision",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "ORDER BY created_at DESC",
        "LIMIT 8;",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ summary: string; created_at: Date | string }>]>() ;

  const [questionRows] = await surreal
    .query<[Array<{ text: string; created_at: Date | string }>]>(
      [
        "SELECT text, created_at",
        "FROM question",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "ORDER BY created_at DESC",
        "LIMIT 8;",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ text: string; created_at: Date | string }>]>() ;

  const lines: string[] = [];
  if (workspace?.description) {
    lines.push(`Workspace: ${workspace.name} — ${workspace.description}`);
  }
  lines.push(
    `Projects: ${projectRows.map((row) => row.name).join(", ") || "none"}`,
    `People: ${personRows.map((row) => row.name).join(", ") || "none"}`,
    `Decisions: ${decisionRows.map((row) => row.summary).join(" | ") || "none"}`,
    `Open questions: ${questionRows.map((row) => row.text).join(" | ") || "none"}`,
  );
  return lines.join("\n");
}
