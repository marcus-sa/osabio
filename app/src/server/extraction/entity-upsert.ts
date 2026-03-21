import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { isRicherEntityName } from "./dedup";
import { isFuzzyNameMatch, normalizeName } from "./normalize";
import type { ExtractionPromptEntity } from "./schema";
import type {
  CandidateEntityRow,
  ExtractableEntityKind,
  GraphEntityRecord,
  PersistableExtractableEntityKind,
  ProjectScopeRow,
  SourceRecord,
} from "./types";
import { ensureProjectFeatureEdge, ensureWorkspaceProjectEdge, resolveEntityProject } from "../workspace/workspace-scope";

export async function upsertGraphEntity(input: {
  surreal: Surreal;
  extractionModelId: string;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceProjects: ProjectScopeRow[];
  sourceRecord: SourceRecord;
  sourceKind: "message" | "document_chunk" | "git_commit";
  promptText: string;
  extracted: ExtractionPromptEntity & { kind: PersistableExtractableEntityKind };
  sourceMessageRecord?: RecordId<"message", string>;
  sourceChunkRecord?: RecordId<"document_chunk", string>;
  sourceCommitRecord?: RecordId<"git_commit", string>;
  resolvedFromMessageRecord?: RecordId<"message", string>;
  now: Date;
}): Promise<{ record: GraphEntityRecord; text: string; kind: PersistableExtractableEntityKind; created: boolean }> {
  const candidates = await loadWorkspaceKindCandidates(input.surreal, input.workspaceRecord, input.extracted.kind);
  const normalizedExtractedText = normalizeName(input.extracted.text);

  const exactNameCandidate = candidates.find((candidate) => normalizeName(candidate.text) === normalizedExtractedText);
  if (exactNameCandidate) {
    const mergedText = await maybeUpgradeMergedEntityName(
      input.surreal,
      input.extracted.kind,
      input.extracted.text,
      exactNameCandidate,
      input.now,
    );

    await createProvenanceEdge({
      surreal: input.surreal,
      sourceRecord: input.sourceRecord,
      targetRecord: exactNameCandidate.id,
      confidence: input.extracted.confidence,
      model: input.extractionModelId,
      now: input.now,
      fromText: input.extracted.text,
      evidence: input.extracted.evidence,
      evidenceSourceRecord: input.sourceMessageRecord,
      resolvedFromRecord: input.resolvedFromMessageRecord,
    });

    return {
      record: exactNameCandidate.id,
      text: mergedText,
      kind: input.extracted.kind,
      created: false,
    };
  }

  // Fuzzy name match dedup (no embedding similarity needed)
  const fuzzyCandidate = candidates.find((candidate) =>
    isFuzzyNameMatch(normalizeName(input.extracted.text), normalizeName(candidate.text)),
  );

  if (fuzzyCandidate) {
    const mergedText = await maybeUpgradeMergedEntityName(
      input.surreal,
      input.extracted.kind,
      input.extracted.text,
      fuzzyCandidate,
      input.now,
    );

    await createProvenanceEdge({
      surreal: input.surreal,
      sourceRecord: input.sourceRecord,
      targetRecord: fuzzyCandidate.id,
      confidence: input.extracted.confidence,
      model: input.extractionModelId,
      now: input.now,
      fromText: input.extracted.text,
      evidence: input.extracted.evidence,
      evidenceSourceRecord: input.sourceMessageRecord,
      resolvedFromRecord: input.resolvedFromMessageRecord,
    });

    return {
      record: fuzzyCandidate.id,
      text: mergedText,
      kind: input.extracted.kind,
      created: false,
    };
  }

  const entityRecord = new RecordId(input.extracted.kind, randomUUID()) as GraphEntityRecord;
  await input.surreal.create(entityRecord).content(
    buildEntityRecordContent(
      input.extracted.kind,
      input.extracted.text,
      input.extracted.confidence,
      input.now,
      input.workspaceRecord,
      input.sourceMessageRecord,
      input.sourceCommitRecord,
      input.extracted.category,
      input.extracted.priority,
    ),
  );

  await createProvenanceEdge({
    surreal: input.surreal,
    sourceRecord: input.sourceRecord,
    targetRecord: entityRecord,
    confidence: input.extracted.confidence,
    model: input.extractionModelId,
    now: input.now,
    fromText: input.extracted.text,
    evidence: input.extracted.evidence,
    evidenceSourceRecord: input.sourceMessageRecord,
    resolvedFromRecord: input.resolvedFromMessageRecord,
  });

  if (input.extracted.kind === "project") {
    await ensureWorkspaceProjectEdge(input.surreal, input.workspaceRecord, entityRecord as RecordId<"project", string>, input.now);
    input.workspaceProjects.push({
      id: entityRecord as RecordId<"project", string>,
      name: input.extracted.text,
    });
  }

  if (input.extracted.kind === "feature") {
    const projectRecord = resolveEntityProject(input.extracted.text, input.promptText, input.workspaceProjects);
    if (projectRecord) {
      await ensureProjectFeatureEdge(input.surreal, projectRecord, entityRecord as RecordId<"feature", string>, input.now);
    }
  }

  if (input.extracted.kind === "task" || input.extracted.kind === "decision" || input.extracted.kind === "question") {
    const projectRecord = resolveEntityProject(input.extracted.text, input.promptText, input.workspaceProjects);
    if (projectRecord) {
      await input.surreal.relate(entityRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
        added_at: input.now,
      }).output("after");
    }
  }

  return {
    record: entityRecord,
    text: input.extracted.text,
    kind: input.extracted.kind,
    created: true,
  };
}

export async function maybeUpgradeMergedEntityName(
  surreal: Surreal,
  kind: PersistableExtractableEntityKind,
  incomingText: string,
  candidate: CandidateEntityRow,
  now: Date,
): Promise<string> {
  if (!isRicherEntityName(incomingText, candidate.text)) {
    return candidate.text;
  }

  if (kind === "project" || kind === "feature") {
    await surreal.update(candidate.id as RecordId<"project" | "feature", string>).merge({
      name: incomingText,
      updated_at: now,
    });
    return incomingText;
  }

  if (kind === "task") {
    await surreal.update(candidate.id as RecordId<"task", string>).merge({
      title: incomingText,
      updated_at: now,
    });
    return incomingText;
  }

  if (kind === "decision") {
    await surreal.update(candidate.id as RecordId<"decision", string>).merge({
      summary: incomingText,
      updated_at: now,
    });
    return incomingText;
  }

  await surreal.update(candidate.id as RecordId<"question", string>).merge({
    text: incomingText,
    updated_at: now,
  });

  return incomingText;
}

export async function createProvenanceEdge(input: {
  surreal: Surreal;
  sourceRecord: SourceRecord;
  targetRecord: GraphEntityRecord;
  confidence: number;
  model: string;
  now: Date;
  fromText: string;
  evidence: string;
  evidenceSourceRecord?: RecordId<"message", string>;
  resolvedFromRecord?: RecordId<"message", string>;
}): Promise<void> {
  await input.surreal.relate(input.sourceRecord, new RecordId("extraction_relation", randomUUID()), input.targetRecord, {
    confidence: input.confidence,
    extracted_at: input.now,
    created_at: input.now,
    model: input.model,
    from_text: input.fromText,
    evidence: input.evidence,
    ...(input.evidenceSourceRecord ? { evidence_source: input.evidenceSourceRecord } : {}),
    ...(input.resolvedFromRecord ? { resolved_from: input.resolvedFromRecord } : {}),
  }).output("after");
}

function buildEntityRecordContent(
  kind: PersistableExtractableEntityKind,
  text: string,
  confidence: number,
  now: Date,
  workspaceRecord: RecordId<"workspace", string>,
  sourceMessageRecord?: RecordId<"message", string>,
  sourceCommitRecord?: RecordId<"git_commit", string>,
  category?: string,
  priority?: string,
): Record<string, unknown> {
  if (kind === "project") {
    return {
      name: text,
      status: "active",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "feature") {
    return {
      name: text,
      status: "active",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "task") {
    return {
      title: text,
      status: "open",
      extraction_confidence: confidence,
      extracted_at: now,
      ...(sourceMessageRecord ? { source_message: sourceMessageRecord } : {}),
      ...(sourceCommitRecord ? { source_commit: sourceCommitRecord } : {}),
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "decision") {
    return {
      summary: text,
      status: "extracted",
      extraction_confidence: confidence,
      extracted_at: now,
      ...(sourceMessageRecord ? { source_message: sourceMessageRecord } : {}),
      ...(sourceCommitRecord ? { source_commit: sourceCommitRecord } : {}),
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    };
  }

  // question (fallthrough)
  return {
    text,
    status: "open",
    extraction_confidence: confidence,
    extracted_at: now,
    ...(sourceMessageRecord ? { source_message: sourceMessageRecord } : {}),
    ...(sourceCommitRecord ? { source_commit: sourceCommitRecord } : {}),
    ...(category ? { category } : {}),
    ...(priority ? { priority } : {}),
    workspace: workspaceRecord,
    created_at: now,
    updated_at: now,
  };
}

export async function loadWorkspaceKindCandidates(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  kind: ExtractableEntityKind,
): Promise<CandidateEntityRow[]> {
  if (kind === "project") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, name AS text FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "person") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, name AS text FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "feature") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        [
          "SELECT id, name AS text",
          "FROM feature",
          "WHERE id IN (",
          "  SELECT VALUE out",
          "  FROM has_feature",
          "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ");",
        ].join(" "),
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "task") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, title AS text FROM task WHERE workspace = $workspace;",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "decision") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, summary AS text FROM decision WHERE workspace = $workspace;",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  const [rows] = await surreal
    .query<[CandidateEntityRow[]]>(
      "SELECT id, text AS text FROM question WHERE workspace = $workspace;",
      { workspace: workspaceRecord },
    )
    .collect<[CandidateEntityRow[]]>();
  return rows;
}

export async function appendWorkspaceTools(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  toolsToAdd: string[],
  now: Date,
): Promise<void> {
  const [rows] = await surreal
    .query<[Array<{ tools?: string[] }>]>("SELECT tools FROM $workspace LIMIT 1;", {
      workspace: workspaceRecord,
    })
    .collect<[Array<{ tools?: string[] }>]>();

  const existingTools = rows[0]?.tools ?? [];
  const merged = [...new Set([...existingTools, ...toolsToAdd])];
  await surreal.update(workspaceRecord).merge({
    tools: merged,
    updated_at: now,
  });
}

export function normalizeRelationshipKind(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_/, "")
    .replace(/_$/, "")
    .toUpperCase();
}

