import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { extractStructuredGraph } from "../extraction/extract-graph";
import { persistExtractionOutput } from "../extraction/persist-extraction";
import { loadWorkspaceGraphContext } from "../extraction/context-loaders";
import { loadWorkspaceProjects } from "../workspace/workspace-scope";
import { findWorkspaceIdentityByName } from "../extraction/identity-resolution";
import { createEmbedding } from "../extraction/embedding-writeback";
import { createObservation } from "../observation/queries";
import { elapsedMs } from "../http/observability";
import type { SourceRecord } from "../extraction/types";
import { updateTaskStatus } from "../mcp/mcp-queries";
import { extractReferencedTaskIds } from "./commit-task-refs";
import { determineTaskStatusUpdates } from "./task-status-from-push";
import { classifyDecisionLinks } from "./types";
import type { CommitInput, ProcessCommitResult, ProcessWebhookInput, ProcessWebhookResult, TaskStatusUpdateResult } from "./types";
import { log } from "../telemetry/logger";

export async function processGitCommits(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
  const startedAt = performance.now();
  const workspaceId = input.workspaceRecord.id as string;

  log.info("webhook.commits.started", "Processing commits", {
    workspaceId,
    repository: input.event.repository.full_name,
    commitCount: input.event.commits.length,
  });

  const projects = await loadWorkspaceProjects(input.surreal, input.workspaceRecord);
  const projectNames = projects.map((p) => p.name);

  const [workspaceRows] = await input.surreal
    .query<[Array<{ name: string }>]>("SELECT name FROM $workspace LIMIT 1;", {
      workspace: input.workspaceRecord,
    })
    .collect<[Array<{ name: string }>]>();
  const workspaceName = workspaceRows[0]?.name;

  const isDefaultBranch = input.event.ref === `refs/heads/${input.event.repository.default_branch}`;

  const result: ProcessWebhookResult = {
    commitsProcessed: 0,
    commitsSkipped: 0,
    totalEntities: 0,
    totalRelationships: 0,
    autoLinkedDecisions: [],
    observationsCreated: [],
    taskStatusUpdates: [],
  };

  for (const rawCommit of input.event.commits) {
    const commit: CommitInput = {
      sha: rawCommit.id,
      message: rawCommit.message,
      authoredAt: rawCommit.timestamp,
      authorName: rawCommit.author.name,
      authorEmail: rawCommit.author.email,
      authorUsername: rawCommit.author.username,
      url: rawCommit.url,
      repository: input.event.repository.full_name,
    };

    try {
      const commitResult = await processCommit({
        surreal: input.surreal,
        extractionModel: input.extractionModel,
        embeddingModel: input.embeddingModel,
        embeddingDimension: input.embeddingDimension,
        extractionStoreThreshold: input.extractionStoreThreshold,
        extractionModelId: input.extractionModelId,
        workspaceRecord: input.workspaceRecord,
        commit,
        workspaceName,
        projectNames,
        autoLinkThreshold: input.autoLinkThreshold,
        isDefaultBranch,
        now: new Date(),
      });

      result.commitsProcessed += 1;
      result.totalEntities += commitResult.entities.length;
      result.totalRelationships += commitResult.relationships.length;
      result.autoLinkedDecisions.push(...commitResult.autoLinkedDecisions);
      result.observationsCreated.push(...commitResult.observationsCreated);
      result.taskStatusUpdates.push(...commitResult.taskStatusUpdates);
    } catch (error) {
      log.error("webhook.commit.failed", "Failed to process commit", error, {
        workspaceId,
        sha: commit.sha,
      });
      result.commitsSkipped += 1;
    }
  }

  log.info("webhook.commits.completed", "Finished processing commits", {
    workspaceId,
    ...result,
    durationMs: elapsedMs(startedAt),
  });

  return result;
}

async function processCommit(input: {
  surreal: typeof import("surrealdb").Surreal.prototype;
  extractionModel: unknown;
  embeddingModel: unknown;
  embeddingDimension: number;
  extractionStoreThreshold: number;
  extractionModelId: string;
  workspaceRecord: RecordId<"workspace", string>;
  commit: CommitInput;
  workspaceName?: string;
  projectNames?: string[];
  autoLinkThreshold: number;
  isDefaultBranch: boolean;
  now: Date;
}): Promise<ProcessCommitResult> {
  const commitRecordId = randomUUID();
  const commitRecord = new RecordId("git_commit", commitRecordId);

  // Resolve author identity
  const authorRecord = await findWorkspaceIdentityByName({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    identityName: input.commit.authorName,
  });

  // Create embedding for commit message
  const embedding = await createEmbedding(
    input.embeddingModel,
    input.embeddingDimension,
    input.commit.message,
  );

  // Persist git_commit record
  await input.surreal.create(commitRecord).content({
    sha: input.commit.sha,
    repository: input.commit.repository,
    message: input.commit.message,
    authored_at: new Date(input.commit.authoredAt),
    ...(authorRecord ? { author: authorRecord } : {}),
    author_name: input.commit.authorName,
    url: input.commit.url,
    workspace: input.workspaceRecord,
    ...(embedding ? { embedding } : {}),
    created_at: input.now,
  });

  log.info("webhook.commit.created", "Created git_commit record", {
    sha: input.commit.sha,
    commitRecordId,
  });

  const referencedTaskIds = extractReferencedTaskIds(input.commit.message);
  let linkedTaskCount = 0;
  let unresolvedTaskIds: string[] = [];
  let linkedTaskSummaries: Array<{ id: string; title: string }> = [];
  const taskStatusResults: TaskStatusUpdateResult[] = [];

  if (referencedTaskIds.length > 0) {
    const taskRecords = referencedTaskIds.map((taskId) => new RecordId("task", taskId));
    const [taskRows] = await input.surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string; status: string }> ]>(
        "SELECT id, title, status FROM task WHERE workspace = $workspace AND id IN $taskIds;",
        { workspace: input.workspaceRecord, taskIds: taskRecords },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string; status: string }>]>();

    const foundTaskIds = new Set(taskRows.map((row) => row.id.id as string));
    unresolvedTaskIds = referencedTaskIds.filter((id) => !foundTaskIds.has(id));

    for (const task of taskRows) {
      await input.surreal
        .relate(task.id, new RecordId("implemented_by", randomUUID()), commitRecord, {
          commit_sha: input.commit.sha,
          linked_at: input.now,
        })
        .output("after");
    }

    linkedTaskCount = taskRows.length;
    linkedTaskSummaries = taskRows.map((row) => ({
      id: row.id.id as string,
      title: row.title,
    }));

    // Determine and apply task status updates based on branch
    const statusUpdates = determineTaskStatusUpdates({
      tasks: taskRows.map((row) => ({
        taskId: row.id.id as string,
        currentStatus: row.status,
      })),
      isDefaultBranch: input.isDefaultBranch,
    });

    for (const update of statusUpdates) {
      try {
        await updateTaskStatus({
          surreal: input.surreal,
          workspaceRecord: input.workspaceRecord,
          taskRecord: new RecordId("task", update.taskId),
          status: update.targetStatus,
        });
        taskStatusResults.push({ taskId: update.taskId, status: update.targetStatus });
        log.info("webhook.commit.task_status", "Updated task status from push", {
          taskId: update.taskId,
          status: update.targetStatus,
          sha: input.commit.sha,
          isDefaultBranch: input.isDefaultBranch,
        });
      } catch (error) {
        log.error("webhook.commit.task_status_failed", "Failed to update task status", error, {
          taskId: update.taskId,
          sha: input.commit.sha,
        });
      }
    }
  }

  log.info("webhook.commit.task_refs", "Processed explicit commit task references", {
    sha: input.commit.sha,
    referencedTaskCount: referencedTaskIds.length,
    linkedTaskCount,
    unresolvedTaskCount: unresolvedTaskIds.length,
  });

  const extractionSourceText = buildCommitExtractionSourceText(
    input.commit.message,
    linkedTaskSummaries,
    unresolvedTaskIds,
  );

  // Load workspace graph context for extraction
  const graphContext = await loadWorkspaceGraphContext(
    input.surreal,
    input.workspaceRecord,
    60,
  );

  // Run extraction on commit message
  const extractionOutput = await extractStructuredGraph({
    extractionModel: input.extractionModel,
    conversationHistory: [],
    graphContext,
    sourceText: extractionSourceText,
    onboarding: false,
    workspaceName: input.workspaceName,
    projectNames: input.projectNames,
  });

  // Persist extracted entities and relationships
  const persisted = await persistExtractionOutput({
    surreal: input.surreal,
    extractionModel: input.extractionModel,
    embeddingModel: input.embeddingModel,
    embeddingDimension: input.embeddingDimension,
    extractionModelId: input.extractionModelId,
    extractionStoreThreshold: input.extractionStoreThreshold,
    workspaceRecord: input.workspaceRecord,
    sourceRecord: commitRecord as SourceRecord,
    sourceKind: "git_commit",
    sourceLabel: `commit ${input.commit.sha.slice(0, 8)}`,
    promptText: extractionSourceText,
    output: extractionOutput,
    sourceCommitRecord: commitRecord,
    now: input.now,
  });

  // Auto-link decisions based on confidence
  const autoLinkedDecisions: string[] = [];
  const observationsCreated: string[] = [];
  const actions = classifyDecisionLinks(persisted.entities, input.autoLinkThreshold);

  for (const action of actions) {
    const decisionRecord = new RecordId("decision", action.entityId);

    if (action.action === "auto_link") {
      await input.surreal
        .relate(decisionRecord, new RecordId("implemented_by", randomUUID()), commitRecord, {
          commit_sha: input.commit.sha,
          linked_at: input.now,
        })
        .output("after");

      autoLinkedDecisions.push(action.entityId);
      log.info("webhook.commit.autolinked", "Auto-linked decision to commit", {
        decisionId: action.entityId,
        sha: input.commit.sha,
        confidence: action.confidence,
      });
    } else {
      const observation = await createObservation({
        surreal: input.surreal,
        workspaceRecord: input.workspaceRecord,
        text: `Commit ${input.commit.sha.slice(0, 8)} may implement decision "${action.text}" (confidence: ${(action.confidence * 100).toFixed(0)}%). Please confirm.`,
        severity: "info",
        sourceAgent: "git_webhook",
        now: input.now,
        relatedRecords: [decisionRecord],
        embeddingDeps: { embeddingModel: input.embeddingModel as any, embeddingDimension: input.embeddingDimension },
      });

      observationsCreated.push(observation.id as string);
      log.info("webhook.commit.observation", "Created confirmation observation", {
        decisionId: action.entityId,
        sha: input.commit.sha,
        confidence: action.confidence,
      });
    }
  }

  return {
    commitRecord,
    entities: persisted.entities,
    relationships: persisted.relationships,
    autoLinkedDecisions,
    observationsCreated,
    taskStatusUpdates: taskStatusResults,
  };
}

function buildCommitExtractionSourceText(
  message: string,
  linkedTasks: Array<{ id: string; title: string }>,
  unresolvedTaskIds: string[],
): string {
  if (linkedTasks.length === 0 && unresolvedTaskIds.length === 0) {
    return message;
  }

  const lines = [message, "", "Explicit task references parsed from commit message:"];
  for (const task of linkedTasks) {
    lines.push(`- task:${task.id} (workspace task title: ${task.title})`);
  }
  for (const taskId of unresolvedTaskIds) {
    lines.push(`- task:${taskId} (not found in this workspace)`);
  }
  return lines.join("\n");
}
