import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { RecordId, Surreal } from "surrealdb";
import type { StreamEvent } from "../app/src/shared/contracts";
import type { SseRegistry } from "../app/src/server/streaming/sse-registry";
import type { ServerConfig } from "../app/src/server/runtime/config";
import type { WorkspaceSeedItem } from "./types";

export function createDeterministicIdGenerator(seed: string): () => string {
  let counter = 0;
  return () => {
    const hash = createHash("sha256").update(`${seed}:${counter++}`).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  };
}

export type EvalRuntime = {
  surreal: Surreal;
  extractionModel: any;
  embeddingModel: any;
  chatAgentModel: any;
  config: ServerConfig;
  namespace: string;
  database: string;
};

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const schemaPath = join(process.cwd(), "schema", "surreal-schema.surql");

export async function setupEvalRuntime(suiteName: string): Promise<EvalRuntime> {
  const namespace = `eval_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `${suiteName}_${Math.floor(Math.random() * 100000)}`;

  const surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });

  // SurrealDB can throw "Cannot perform subtraction with 'NONE'" during
  // namespace/database operations when leftover computed fields exist.
  // Swallow these benign errors during setup.
  const setupQuery = async (sql: string) => {
    await surreal.query(sql).catch((error) => {
      if (!isAlreadyExistsError(error) && !isNoneSubtractionError(error)) throw error;
    });
  };
  await setupQuery(`DEFINE NAMESPACE IF NOT EXISTS ${namespace};`);
  await surreal.use({ namespace, database: undefined as any });
  await setupQuery(`REMOVE DATABASE IF EXISTS ${database};`);
  await setupQuery(`DEFINE DATABASE IF NOT EXISTS ${database};`);
  await surreal.use({ namespace, database });

  const schemaSql = readFileSync(schemaPath, "utf8");
  // Split schema into individual statements to isolate errors.
  // SurrealDB multi-statement queries can fail mid-batch; splitting lets us
  // skip benign runtime errors (like subtraction on NONE in DEFINE FUNCTION
  // validation) while still applying all schema definitions.
  const schemaStatements = splitSurqlStatements(schemaSql);
  for (const stmt of schemaStatements) {
    await surreal.query(stmt).catch((error) => {
      if (!isAlreadyExistsError(error) && !isNoneSubtractionError(error)) throw error;
    });
  }

  const openRouterApiKey = requireEnv("OPENROUTER_API_KEY");
  const extractionModelId = requireEnv("EXTRACTION_MODEL");
  const chatAgentModelId = requireEnv("CHAT_AGENT_MODEL");
  const embeddingModelId = requireEnv("OPENROUTER_EMBEDDING_MODEL");
  const embeddingDimension = Number(requireEnv("EMBEDDING_DIMENSION"));
  const extractionStoreThreshold = Number(process.env.EXTRACTION_STORE_THRESHOLD ?? "0.3");
  const extractionDisplayThreshold = Number(process.env.EXTRACTION_DISPLAY_THRESHOLD ?? "0.5");

  const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
  const extractionModel = openrouter(extractionModelId, { plugins: [{ id: "response-healing" }] });
  const chatAgentModel = openrouter(chatAgentModelId, { plugins: [{ id: "response-healing" }] });
  const embeddingModel = openrouter.textEmbeddingModel(embeddingModelId);

  const pmAgentModelId = process.env.PM_AGENT_MODEL?.trim() || extractionModelId;
  const analyticsAgentModelId = process.env.ANALYTICS_MODEL?.trim() || "unknown";

  const config: ServerConfig = {
    openRouterApiKey,
    chatAgentModelId,
    extractionModelId,
    pmAgentModelId,
    analyticsAgentModelId,
    embeddingModelId,
    embeddingDimension,
    extractionStoreThreshold,
    extractionDisplayThreshold,
    surrealUrl,
    surrealUsername,
    surrealPassword,
    surrealNamespace: namespace,
    surrealDatabase: database,
    port: 0,
  };

  return {
    surreal,
    extractionModel,
    embeddingModel,
    chatAgentModel,
    config,
    namespace,
    database,
  };
}

export async function teardownEvalRuntime(runtime: EvalRuntime): Promise<void> {
  await runtime.surreal.query(`REMOVE DATABASE ${runtime.database};`).catch(() => undefined);
  await runtime.surreal.query(`REMOVE NAMESPACE ${runtime.namespace};`).catch(() => undefined);
  await runtime.surreal.close().catch(() => undefined);
}

export async function seedWorkspace(surreal: Surreal, workspaceName?: string, nextId?: () => string): Promise<{
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  projectRecord: RecordId<"project", string>;
  conversationRecord: RecordId<"conversation", string>;
  ownerPersonCount: number;
}> {
  const id = nextId ?? randomUUID;
  const now = new Date();
  const resolvedWorkspaceName = workspaceName ?? `Eval ${Date.now()}`;
  const workspaceRecord = new RecordId("workspace", id());
  const projectRecord = new RecordId("project", id());
  const conversationRecord = new RecordId("conversation", id());
  const ownerRecord = new RecordId("identity", id());

  await surreal.create(workspaceRecord).content({
    name: resolvedWorkspaceName,
    status: "active",
    onboarding_complete: false,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
    updated_at: now,
  });

  await surreal.create(projectRecord).content({
    name: "Eval Project",
    status: "active",
    created_at: now,
    updated_at: now,
  });

  // NOTE: Do NOT link default eval project to workspace via has_project.
  // Only workspace_seed projects should appear in workspace scope so the
  // extraction LLM sees the correct project list for project-vs-feature classification.

  await surreal.create(ownerRecord).content({
    name: "Marcus",
    type: "human",
    workspace: workspaceRecord,
    identity_status: "active",
    created_at: now,
  });

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET role = 'owner', added_at = $now;`,
    { identity: ownerRecord, workspace: workspaceRecord, now },
  );

  await surreal.create(conversationRecord).content({
    createdAt: now,
    updatedAt: now,
    workspace: workspaceRecord,
    source: "onboarding",
  });

  return { workspaceRecord, workspaceName: resolvedWorkspaceName, projectRecord, conversationRecord, ownerPersonCount: 1 };
}

export async function seedConversationContext(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
  context: Array<{ role: "user" | "assistant"; text: string }>,
  nextId?: () => string,
): Promise<string[]> {
  const id = nextId ?? randomUUID;
  const now = Date.now();
  const messageIds: string[] = [];
  for (const [index, message] of context.entries()) {
    const seededMessageRecord = new RecordId("message", id());
    await surreal.create(seededMessageRecord).content({
      conversation: conversationRecord,
      role: message.role,
      text: message.text,
      createdAt: new Date(now + index),
    });
    messageIds.push(seededMessageRecord.id as string);
  }
  return messageIds;
}

export async function seedUserMessage(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
  text: string,
  nextId?: () => string,
): Promise<RecordId<"message", string>> {
  const messageRecord = new RecordId("message", (nextId ?? randomUUID)());
  await surreal.create(messageRecord).content({
    conversation: conversationRecord,
    role: "user",
    text,
    createdAt: new Date(),
  });
  return messageRecord;
}

export async function loadWorkspacePeopleCount(
  surreal: Surreal,
  workspace: RecordId<"workspace", string>,
): Promise<number> {
  const [people] = await surreal
    .query<[Array<{ id: RecordId<"person", string> }>]>(
      "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
      { workspace },
    )
    .collect<[Array<{ id: RecordId<"person", string> }>]>();
  return people.length;
}


export async function seedGraphEntities(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  conversationRecord: RecordId<"conversation", string>,
  seeds: WorkspaceSeedItem[],
  nextId?: () => string,
): Promise<void> {
  const id = nextId ?? randomUUID;
  const now = new Date();
  const seedMessageRecord = new RecordId("message", id());
  await surreal.create(seedMessageRecord).content({
    conversation: conversationRecord,
    role: "assistant",
    text: "Workspace seed context.",
    createdAt: new Date(now.getTime() - 60_000),
  });

  for (const seed of seeds) {
    const entityRecord = new RecordId(seed.kind, id());
    await surreal.create(entityRecord).content(buildSeedEntityContent(seed.kind, seed.text, now));

    await surreal.relate(seedMessageRecord, new RecordId("extraction_relation", id()), entityRecord, {
      confidence: 0.95,
      extracted_at: now,
      created_at: now,
      model: "seed",
      from_text: seed.text,
      evidence: seed.text,
      evidence_source: seedMessageRecord,
    }).output("after");

    if (seed.kind === "feature") {
      await surreal.relate(projectRecord, new RecordId("has_feature", id()), entityRecord as RecordId<"feature", string>, {
        added_at: now,
      }).output("after");
    }

    if (seed.kind === "task" || seed.kind === "decision" || seed.kind === "question") {
      await surreal.relate(entityRecord, new RecordId("belongs_to", id()), projectRecord, {
        added_at: now,
      }).output("after");
    }

    if (seed.kind === "project") {
      await surreal.relate(workspaceRecord, new RecordId("has_project", id()), entityRecord as RecordId<"project", string>, {
        added_at: now,
      }).output("after");
    }
  }
}

function buildSeedEntityContent(kind: string, text: string, now: Date): Record<string, unknown> {
  const base = { created_at: now, updated_at: now };
  if (kind === "project") return { ...base, name: text, status: "active" };
  if (kind === "feature") return { ...base, name: text, status: "active" };
  if (kind === "task") return { ...base, title: text, status: "open" };
  if (kind === "decision") return { ...base, summary: text, status: "extracted" };
  return { ...base, text, status: "open" };
}

export function createEventCollector(): SseRegistry & { getEvents(messageId: string): StreamEvent[] } {
  const events = new Map<string, StreamEvent[]>();
  return {
    registerMessage(messageId: string) {
      events.set(messageId, []);
    },
    handleStreamRequest(_messageId: string): Response {
      throw new Error("handleStreamRequest not available in eval mode");
    },
    emitEvent(messageId: string, event: StreamEvent) {
      events.get(messageId)?.push(event);
    },
    getEvents(messageId: string): StreamEvent[] {
      return events.get(messageId) ?? [];
    },
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already exists");
}

function isNoneSubtractionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Cannot perform subtraction with 'NONE'");
}

/**
 * Split a .surql file into individual top-level statements.
 * Handles BEGIN TRANSACTION...COMMIT TRANSACTION blocks as single units,
 * and DEFINE FUNCTION...}; blocks as single units.
 */
function splitSurqlStatements(sql: string): string[] {
  const lines = sql.split("\n");
  const statements: string[] = [];
  let current: string[] = [];
  let inTransaction = false;
  let inFunction = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments at top level
    if (!inTransaction && !inFunction && (trimmed === "" || trimmed.startsWith("--"))) {
      continue;
    }

    if (trimmed.startsWith("BEGIN TRANSACTION") || trimmed === "BEGIN TRANSACTION;") {
      inTransaction = true;
      current.push(line);
      continue;
    }

    if (inTransaction) {
      current.push(line);
      if (trimmed.startsWith("COMMIT TRANSACTION") || trimmed === "COMMIT TRANSACTION;") {
        inTransaction = false;
        statements.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    if (trimmed.startsWith("DEFINE FUNCTION")) {
      inFunction = true;
      current.push(line);
      continue;
    }

    if (inFunction) {
      current.push(line);
      if (trimmed === "};") {
        inFunction = false;
        statements.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    // Regular statement (single line ending with ;)
    if (trimmed.endsWith(";")) {
      current.push(line);
      statements.push(current.join("\n"));
      current = [];
    } else if (trimmed.length > 0) {
      // Multi-line statement continuation
      current.push(line);
    }
  }

  if (current.length > 0) {
    statements.push(current.join("\n"));
  }

  return statements.filter((s) => s.trim().length > 0);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
