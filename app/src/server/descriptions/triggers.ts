import type { RecordId, Surreal } from "surrealdb";
import { logError, logInfo } from "../http/observability";
import { appendDescriptionEntry } from "./persist";
import type { DescriptionEntry, DescriptionTarget, DescriptionTrigger } from "./types";

type AffectedEntity = {
  id: RecordId;
  type: DescriptionTarget;
};

export async function fireDescriptionUpdates(input: {
  surreal: Surreal;
  extractionModel: any;
  trigger: DescriptionTrigger;
}): Promise<void> {
  const affected = await findAffectedEntities(input.surreal, input.trigger);

  if (affected.length === 0) {
    return;
  }

  logInfo("description.trigger.fire", "Firing description updates", {
    triggerKind: input.trigger.kind,
    triggerEntity: `${input.trigger.entity.table}:${input.trigger.entity.id}`,
    affectedCount: affected.length,
  });

  const entry: DescriptionEntry = {
    text: input.trigger.summary,
    source: input.trigger.entity,
    created_at: new Date(),
  };

  const updates = affected.map((target) =>
    appendDescriptionEntry({
      surreal: input.surreal,
      extractionModel: input.extractionModel,
      targetRecord: target.id,
      targetType: target.type,
      entry,
    }).catch((error) => {
      logError("description.trigger.update_failed", "Description update failed for target", error, {
        triggerKind: input.trigger.kind,
        targetRecord: `${target.id.table}:${target.id.id}`,
      });
    }),
  );

  await Promise.all(updates);
}

async function findAffectedEntities(
  surreal: Surreal,
  trigger: DescriptionTrigger,
): Promise<AffectedEntity[]> {
  const table = trigger.entity.table.name;

  if (trigger.kind === "decision_confirmed" && table === "decision") {
    return findEntitiesRelatedToDecision(surreal, trigger.entity);
  }

  if (trigger.kind === "task_completed" && table === "task") {
    return findEntitiesRelatedToTask(surreal, trigger.entity);
  }

  if (trigger.kind === "feature_created" || trigger.kind === "feature_completed") {
    return findEntitiesRelatedToFeature(surreal, trigger.entity);
  }

  return [];
}

async function findEntitiesRelatedToDecision(
  surreal: Surreal,
  decisionRecord: RecordId,
): Promise<AffectedEntity[]> {
  // A decision belongs_to projects and features
  const [rows] = await surreal
    .query<[Array<{ out: RecordId }>]>(
      "SELECT out FROM belongs_to WHERE `in` = $decision;",
      { decision: decisionRecord },
    )
    .collect<[Array<{ out: RecordId }>]>();

  const affected: AffectedEntity[] = [];
  for (const row of rows) {
    const table = row.out.table.name;
    if (table === "project" || table === "feature") {
      affected.push({ id: row.out, type: table });
    }
  }

  // Also find tasks that belong to the same project/feature
  if (affected.length > 0) {
    const parentIds = affected.map((e) => e.id);
    const [taskRows] = await surreal
      .query<[Array<{ in: RecordId }>]>(
        "SELECT `in` FROM belongs_to WHERE out IN $parents AND record::table(`in`) = 'task';",
        { parents: parentIds },
      )
      .collect<[Array<{ in: RecordId }>]>();

    for (const row of taskRows) {
      affected.push({ id: row.in, type: "task" });
    }
  }

  return affected;
}

async function findEntitiesRelatedToTask(
  surreal: Surreal,
  taskRecord: RecordId,
): Promise<AffectedEntity[]> {
  // A task belongs_to features and projects
  const [rows] = await surreal
    .query<[Array<{ out: RecordId }>]>(
      "SELECT out FROM belongs_to WHERE `in` = $task;",
      { task: taskRecord },
    )
    .collect<[Array<{ out: RecordId }>]>();

  return rows
    .filter((row) => {
      const table = row.out.table.name;
      return table === "project" || table === "feature";
    })
    .map((row) => ({
      id: row.out,
      type: row.out.table.name as DescriptionTarget,
    }));
}

async function findEntitiesRelatedToFeature(
  surreal: Surreal,
  featureRecord: RecordId,
): Promise<AffectedEntity[]> {
  // A feature is linked to projects via has_feature (project -> feature)
  const [rows] = await surreal
    .query<[Array<{ in: RecordId }>]>(
      "SELECT `in` FROM has_feature WHERE out = $feature;",
      { feature: featureRecord },
    )
    .collect<[Array<{ in: RecordId }>]>();

  return rows.map((row) => ({
    id: row.in,
    type: "project" as DescriptionTarget,
  }));
}
