import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import type {
  ConversationSidebarItem,
  ProjectConversationGroup,
  ProjectFeatureActivity,
  WorkspaceConversationSidebarResponse,
} from "../../shared/contracts";
import type { GraphEntityRecord } from "../extraction/types";
import { toIsoString } from "../http/response";
import { logInfo } from "../http/observability";

// ── Pure functions (exported for unit testing) ──────────────────────────

export type TouchedByEdge = {
  projectId: string;
  conversationId: string;
  entityCount: number;
  firstMentionAt: string;
};

export type ConversationGroupInput = {
  id: string;
  title?: string;
  updatedAt: string;
  touchedBy: Array<{ projectId: string; entityCount: number }>;
  parentId?: string;
};

export type GroupingResult = {
  groups: Map<string, ConversationSidebarItem[]>;
  unlinked: ConversationSidebarItem[];
};

/**
 * Groups conversations by dominant project using strict majority heuristic.
 * A conversation is assigned to a project only if that project's entity_count
 * is strictly greater than half of the total entity count across all projects.
 */
export function groupConversationsByProject(conversations: ConversationGroupInput[]): GroupingResult {
  const groups = new Map<string, ConversationSidebarItem[]>();
  const unlinked: ConversationSidebarItem[] = [];

  for (const conv of conversations) {
    const item: ConversationSidebarItem = {
      id: conv.id,
      title: conv.title ?? "Untitled",
      updatedAt: conv.updatedAt,
    };

    if (conv.touchedBy.length === 0) {
      unlinked.push(item);
      continue;
    }

    const total = conv.touchedBy.reduce((sum, edge) => sum + edge.entityCount, 0);
    let topEdge = conv.touchedBy[0];
    for (const edge of conv.touchedBy) {
      if (edge.entityCount > topEdge.entityCount) {
        topEdge = edge;
      }
    }

    if (topEdge.entityCount > total / 2) {
      const existing = groups.get(topEdge.projectId) ?? [];
      existing.push(item);
      groups.set(topEdge.projectId, existing);
    } else {
      unlinked.push(item);
    }
  }

  return { groups, unlinked };
}

/**
 * Derives the initial title for a conversation from the first user message.
 */
export function deriveMessageTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 72) {
    return trimmed;
  }
  return `${trimmed.slice(0, 69)}...`;
}

export type TitleUpgradeInput = {
  titleSource?: "message" | "entity";
  entityTexts: Array<{ kind: string; text: string }>;
  dominantProjectName?: string;
};

/**
 * Determines whether a conversation title should be upgraded and returns
 * the new title if so. Returns undefined if no upgrade should happen.
 */
export function computeTitleUpgrade(input: TitleUpgradeInput): string | undefined {
  if (input.titleSource !== "message") {
    return undefined;
  }

  const qualifying = input.entityTexts.filter(
    (entity) => entity.kind !== "person" && entity.kind !== "workspace",
  );

  if (qualifying.length < 3) {
    return undefined;
  }

  if (input.dominantProjectName) {
    return deriveMessageTitle(input.dominantProjectName);
  }

  // Use the most common entity text as fallback
  const counts = new Map<string, number>();
  for (const entity of qualifying) {
    const key = entity.text.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let bestText = qualifying[0].text;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestText = qualifying.find((e) => e.text.toLowerCase() === key)?.text ?? bestText;
    }
  }

  return deriveMessageTitle(bestText);
}

// ── Entity-to-project resolution ────────────────────────────────────────

type ExtractionEdgeRow = {
  out: GraphEntityRecord;
  extracted_at: Date | string;
};

type BelongsToRow = {
  out: RecordId<string, string> & { tb: string };
};

type HasFeatureRow = {
  in: RecordId<"project", string>;
};

/**
 * Resolves which project(s) an extracted entity belongs to.
 * Returns a map of projectId -> { entityIds, earliestExtractedAt }.
 */
async function resolveEntityToProjects(
  surreal: Surreal,
  entityRecord: GraphEntityRecord,
): Promise<RecordId<"project", string>[]> {
  const table = entityRecord.tb;

  if (table === "project") {
    return [entityRecord as unknown as RecordId<"project", string>];
  }

  if (table === "feature") {
    const [rows] = await surreal
      .query<[HasFeatureRow[]]>(
        "SELECT `in` FROM has_feature WHERE out = $feature;",
        { feature: entityRecord },
      )
      .collect<[HasFeatureRow[]]>();
    return rows.map((row) => row.in);
  }

  if (table === "task" || table === "decision" || table === "question") {
    const [belongsToRows] = await surreal
      .query<[BelongsToRow[]]>(
        "SELECT out FROM belongs_to WHERE `in` = $entity;",
        { entity: entityRecord },
      )
      .collect<[BelongsToRow[]]>();

    const projects: RecordId<"project", string>[] = [];

    for (const row of belongsToRows) {
      if (row.out.tb === "project") {
        projects.push(row.out as RecordId<"project", string>);
      } else if (row.out.tb === "feature") {
        const [featureRows] = await surreal
          .query<[HasFeatureRow[]]>(
            "SELECT `in` FROM has_feature WHERE out = $feature;",
            { feature: row.out },
          )
          .collect<[HasFeatureRow[]]>();
        projects.push(...featureRows.map((r) => r.in));
      }
    }

    return projects;
  }

  // person, workspace, and other kinds do not contribute
  return [];
}

// ── Database operations ─────────────────────────────────────────────────

type TouchedByRow = {
  id: RecordId<"touched_by", string>;
  in: RecordId<"project", string>;
  out: RecordId<"conversation", string>;
  entity_count: number;
  first_mention_at: Date | string;
};

/**
 * Refreshes the touched_by edges for a conversation based on its extraction_relation rows.
 */
export async function refreshConversationTouchedBy(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
): Promise<void> {
  const [extractionRows] = await surreal
    .query<[ExtractionEdgeRow[]]>(
      "SELECT out, extracted_at FROM extraction_relation WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation = $conversation);",
      { conversation: conversationRecord },
    )
    .collect<[ExtractionEdgeRow[]]>();

  // Aggregate: projectId -> { uniqueEntityIds, earliestExtractedAt }
  const projectAgg = new Map<string, { entityIds: Set<string>; earliestAt: Date }>();

  for (const row of extractionRows) {
    const projects = await resolveEntityToProjects(surreal, row.out);
    const extractedAt = row.extracted_at instanceof Date ? row.extracted_at : new Date(row.extracted_at as string);
    const entityId = `${row.out.tb}:${row.out.id}`;

    for (const projectRecord of projects) {
      const projectId = projectRecord.id as string;
      const existing = projectAgg.get(projectId);
      if (existing) {
        existing.entityIds.add(entityId);
        if (extractedAt < existing.earliestAt) {
          existing.earliestAt = extractedAt;
        }
      } else {
        projectAgg.set(projectId, {
          entityIds: new Set([entityId]),
          earliestAt: extractedAt,
        });
      }
    }
  }

  // Load existing touched_by edges for this conversation
  const [existingEdges] = await surreal
    .query<[TouchedByRow[]]>(
      "SELECT id, `in`, out, entity_count, first_mention_at FROM touched_by WHERE out = $conversation;",
      { conversation: conversationRecord },
    )
    .collect<[TouchedByRow[]]>();

  const existingByProject = new Map<string, TouchedByRow>();
  for (const edge of existingEdges) {
    existingByProject.set(edge.in.id as string, edge);
  }

  // Upsert edges for current project aggregations
  for (const [projectId, agg] of projectAgg) {
    const existing = existingByProject.get(projectId);
    const entityCount = agg.entityIds.size;

    if (existing) {
      await surreal.update(existing.id).merge({
        entity_count: entityCount,
        first_mention_at: agg.earliestAt,
      });
      existingByProject.delete(projectId);
    } else {
      const projectRecord = new RecordId("project", projectId);
      await surreal.relate(
        projectRecord,
        new RecordId("touched_by", randomUUID()),
        conversationRecord,
        {
          first_mention_at: agg.earliestAt,
          entity_count: entityCount,
        },
      ).output("after");
    }
  }

  // Remove stale edges (projects no longer represented)
  for (const staleEdge of existingByProject.values()) {
    await surreal.delete(staleEdge.id);
  }

  logInfo("conversation.touched_by.refreshed", "Refreshed touched_by edges", {
    conversationId: conversationRecord.id as string,
    projectCount: projectAgg.size,
    removedCount: existingByProject.size,
  });
}

/**
 * Upgrades a conversation title if conditions are met (title_source === "message",
 * >= 3 qualifying entities extracted).
 */
export async function maybeUpgradeConversationTitle(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
): Promise<void> {
  const conversation = await surreal.select<{
    title?: string;
    title_source?: "message" | "entity";
  }>(conversationRecord);

  if (!conversation || conversation.title_source !== "message") {
    return;
  }

  // Count qualifying extracted entities for this conversation
  const [entityRows] = await surreal
    .query<[Array<{ out: GraphEntityRecord }>]>(
      "SELECT out FROM extraction_relation WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation = $conversation);",
      { conversation: conversationRecord },
    )
    .collect<[Array<{ out: GraphEntityRecord }>]>();

  const uniqueEntities = new Map<string, { kind: string; text: string }>();
  for (const row of entityRows) {
    const key = `${row.out.tb}:${row.out.id}`;
    if (!uniqueEntities.has(key)) {
      uniqueEntities.set(key, { kind: row.out.tb, text: "" });
    }
  }

  const qualifying = [...uniqueEntities.values()].filter(
    (e) => e.kind !== "person" && e.kind !== "workspace",
  );

  if (qualifying.length < 3) {
    return;
  }

  // Check for dominant project via touched_by
  const [touchedByRows] = await surreal
    .query<[Array<{ in: RecordId<"project", string>; entity_count: number }>]>(
      "SELECT `in`, entity_count FROM touched_by WHERE out = $conversation;",
      { conversation: conversationRecord },
    )
    .collect<[Array<{ in: RecordId<"project", string>; entity_count: number }>]>();

  let dominantProjectName: string | undefined;
  if (touchedByRows.length > 0) {
    const total = touchedByRows.reduce((sum, row) => sum + row.entity_count, 0);
    let topRow = touchedByRows[0];
    for (const row of touchedByRows) {
      if (row.entity_count > topRow.entity_count) {
        topRow = row;
      }
    }

    if (topRow.entity_count > total / 2) {
      const project = await surreal.select<{ name: string }>(topRow.in);
      if (project) {
        dominantProjectName = project.name;
      }
    }
  }

  // Get entity texts for fallback title
  const entityTexts: Array<{ kind: string; text: string }> = [];
  for (const [, entry] of uniqueEntities) {
    entityTexts.push(entry);
  }

  // Need actual texts from entities
  const entityTextRows: Array<{ kind: string; text: string }> = [];
  for (const row of entityRows) {
    const kind = row.out.tb;
    if (kind === "person" || kind === "workspace") continue;

    const textField = kind === "task" ? "title" : kind === "decision" ? "summary" : "text";
    const entity = await surreal.select<Record<string, string>>(row.out);
    if (entity) {
      const text = entity[textField] ?? entity.name ?? "";
      entityTextRows.push({ kind, text });
    }
  }

  const newTitle = computeTitleUpgrade({
    titleSource: "message",
    entityTexts: entityTextRows,
    dominantProjectName,
  });

  if (newTitle) {
    await surreal.update(conversationRecord).merge({
      title: newTitle,
      title_source: "entity" as const,
    });

    logInfo("conversation.title.upgraded", "Upgraded conversation title", {
      conversationId: conversationRecord.id as string,
      newTitle,
    });
  }
}

// ── Sidebar builder ─────────────────────────────────────────────────────

type ConversationSidebarRow = {
  id: RecordId<"conversation", string>;
  title?: string;
  updatedAt: Date | string;
};

type FeatureActivityRow = {
  featureId: RecordId<"feature", string>;
  featureName: string;
  latestActivityAt: Date | string;
};

type BranchedFromRow = {
  in: RecordId<"conversation", string>;
  out: RecordId<"conversation", string>;
};

/**
 * Recursively attaches branch conversations to their parent items.
 */
function attachBranches(
  item: ConversationSidebarItem,
  childrenMap: Map<string, ConversationSidebarItem[]>,
): ConversationSidebarItem {
  const children = childrenMap.get(item.id);
  if (!children || children.length === 0) return item;
  return {
    ...item,
    branches: children.map((child) => attachBranches(child, childrenMap)),
  };
}

export async function buildWorkspaceConversationSidebar(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<WorkspaceConversationSidebarResponse> {
  // Load all conversations for this workspace
  const [conversationRows] = await surreal
    .query<[ConversationSidebarRow[]]>(
      "SELECT id, title, updatedAt FROM conversation WHERE workspace = $workspace ORDER BY updatedAt DESC;",
      { workspace: workspaceRecord },
    )
    .collect<[ConversationSidebarRow[]]>();

  // Load all touched_by edges for these conversations
  const conversationIds = conversationRows.map((row) => row.id);
  const [touchedByRows] = await surreal
    .query<[TouchedByRow[]]>(
      "SELECT id, `in`, out, entity_count, first_mention_at FROM touched_by WHERE out IN $conversations;",
      { conversations: conversationIds },
    )
    .collect<[TouchedByRow[]]>();

  // Load branched_from edges to build parent/child relationships
  const [branchEdges] = await surreal
    .query<[BranchedFromRow[]]>(
      "SELECT `in`, out FROM branched_from WHERE `in` IN $conversations;",
      { conversations: conversationIds },
    )
    .collect<[BranchedFromRow[]]>();

  // Build branch parent/child maps
  const parentMap = new Map<string, string>();
  for (const edge of branchEdges) {
    parentMap.set(edge.in.id as string, edge.out.id as string);
  }

  // Build touched_by lookup by conversation
  const touchedByMap = new Map<string, Array<{ projectId: string; entityCount: number }>>();
  for (const row of touchedByRows) {
    const convId = row.out.id as string;
    const existing = touchedByMap.get(convId) ?? [];
    existing.push({ projectId: row.in.id as string, entityCount: row.entity_count });
    touchedByMap.set(convId, existing);
  }

  // Build sidebar items for ALL conversations (including branches)
  const allItems = new Map<string, ConversationSidebarItem>();
  for (const row of conversationRows) {
    const id = row.id.id as string;
    allItems.set(id, {
      id,
      title: row.title ?? "Untitled",
      updatedAt: toIsoString(row.updatedAt),
      ...(parentMap.has(id) ? { parentId: parentMap.get(id) } : {}),
    });
  }

  // Build children lookup (parentId -> child items)
  const childrenMap = new Map<string, ConversationSidebarItem[]>();
  for (const [childId, parentId] of parentMap) {
    const childItem = allItems.get(childId);
    if (!childItem) continue;
    const children = childrenMap.get(parentId) ?? [];
    children.push(childItem);
    childrenMap.set(parentId, children);
  }

  // Only group root conversations (those without a parent)
  const conversationInputs: ConversationGroupInput[] = conversationRows
    .filter((row) => !parentMap.has(row.id.id as string))
    .map((row) => ({
      id: row.id.id as string,
      title: row.title,
      updatedAt: toIsoString(row.updatedAt),
      touchedBy: touchedByMap.get(row.id.id as string) ?? [],
    }));

  const { groups, unlinked } = groupConversationsByProject(conversationInputs);

  // Load project names and build groups, attaching branches
  const projectGroups: ProjectConversationGroup[] = [];
  for (const [projectId, conversations] of groups) {
    const projectRecord = new RecordId("project", projectId);
    const project = await surreal.select<{ name: string }>(projectRecord);
    if (!project) continue;

    const withBranches = conversations.map((conv) => attachBranches(conv, childrenMap));
    const featureActivity = await loadProjectFeatureActivity(surreal, projectRecord, withBranches);

    projectGroups.push({
      projectId,
      projectName: project.name,
      conversations: withBranches,
      featureActivity,
    });
  }

  const unlinkedWithBranches = unlinked.map((conv) => attachBranches(conv, childrenMap));

  return { groups: projectGroups, unlinked: unlinkedWithBranches };
}

async function loadProjectFeatureActivity(
  surreal: Surreal,
  projectRecord: RecordId<"project", string>,
  _conversations: ConversationSidebarItem[],
): Promise<ProjectFeatureActivity[]> {
  // Get features for this project with latest extraction activity
  const [rows] = await surreal
    .query<[FeatureActivityRow[]]>(
      [
        "SELECT out.id AS featureId, out.name AS featureName, math::max(extracted_at) AS latestActivityAt",
        "FROM extraction_relation",
        "WHERE out IN (SELECT VALUE out FROM has_feature WHERE `in` = $project)",
        "GROUP BY out",
        "ORDER BY latestActivityAt DESC",
        "LIMIT 5;",
      ].join(" "),
      { project: projectRecord },
    )
    .collect<[FeatureActivityRow[]]>();

  return rows.map((row) => ({
    featureId: (row.featureId as unknown as RecordId<"feature", string>).id as string,
    featureName: row.featureName,
    latestActivityAt: toIsoString(row.latestActivityAt),
  }));
}
