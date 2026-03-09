import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { jsonError, jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { processGitCommits } from "./github-commit-processor";
import type { GitHubPushEvent } from "./types";

export function createGitHubWebhookHandler(
  deps: ServerDependencies,
): (workspaceId: string, request: Request) => Promise<Response> {
  return (workspaceId: string, request: Request) =>
    handleGitHubWebhook(deps, workspaceId, request);
}

async function handleGitHubWebhook(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const eventType = request.headers.get("x-github-event");
  if (!eventType) {
    return jsonError("missing x-github-event header", 400);
  }

  if (eventType !== "push") {
    logInfo("webhook.github.skipped", "Non-push event ignored", { eventType });
    return jsonResponse({ accepted: true, reason: "event type not processed" }, 200);
  }

  const rawBody = await request.text();

  if (deps.config.githubWebhookSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return jsonError("missing x-hub-signature-256 header", 401);
    }

    const valid = await verifyGitHubSignature(deps.config.githubWebhookSecret, rawBody, signature);
    if (!valid) {
      return jsonError("invalid signature", 401);
    }
  }

  const event = JSON.parse(rawBody) as GitHubPushEvent;

  if (!event.ref.startsWith("refs/heads/")) {
    logInfo("webhook.github.skipped", "Non-branch push ignored", {
      ref: event.ref,
    });
    return jsonResponse({ accepted: true, reason: "non-branch ref" }, 200);
  }

  if (event.commits.length === 0) {
    return jsonResponse({ accepted: true, reason: "no commits" }, 200);
  }

  let workspaceRecord;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch {
    return jsonError("workspace not found", 404);
  }

  logInfo("webhook.github.accepted", "Processing push event", {
    workspaceId,
    repository: event.repository.full_name,
    commitCount: event.commits.length,
  });

  // Fire-and-forget: process commits asynchronously so we return 200 within GitHub's timeout
  const work = processGitCommits({
    surreal: deps.surreal,
    extractionModel: deps.extractionModel,
    embeddingModel: deps.embeddingModel,
    embeddingDimension: deps.config.embeddingDimension,
    extractionStoreThreshold: deps.config.extractionStoreThreshold,
    extractionModelId: deps.config.extractionModelId,
    workspaceRecord,
    event,
    autoLinkThreshold: 0.85,
  }).catch((error) => {
    logError("webhook.github.processing_failed", "Commit processing failed", error, {
      workspaceId,
      repository: event.repository.full_name,
    });
  });
  deps.inflight.track(work);

  return jsonResponse({
    accepted: true,
    commitsQueued: event.commits.length,
  }, 202);
}

async function verifyGitHubSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const computed = `sha256=${Buffer.from(sig).toString("hex")}`;

  if (computed.length !== signature.length) {
    return false;
  }

  // Constant-time comparison
  const a = encoder.encode(computed);
  const b = encoder.encode(signature);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
