import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { RecordId, Surreal } from "surrealdb";
import type { StreamEvent } from "../app/src/shared/contracts";
import type { SseRegistry } from "../app/src/server/streaming/sse-registry";
import type { ServerConfig } from "../app/src/server/runtime/config";

export type EvalRuntime = {
  surreal: Surreal;
  extractionModel: any;
  embeddingModel: any;
  assistantModel: any;
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

  await surreal.query(`DEFINE NAMESPACE ${namespace};`).catch((error) => {
    if (!isAlreadyExistsError(error)) throw error;
  });
  await surreal.use({ namespace, database });
  await surreal.query(`REMOVE DATABASE ${database};`).catch(() => undefined);
  await surreal.query(`DEFINE DATABASE ${database};`).catch((error) => {
    if (!isAlreadyExistsError(error)) throw error;
  });
  await surreal.use({ namespace, database });

  const schemaSql = readFileSync(schemaPath, "utf8");
  await surreal.query(schemaSql).catch((error) => {
    if (!isAlreadyExistsError(error)) throw error;
  });

  const openRouterApiKey = requireEnv("OPENROUTER_API_KEY");
  const extractionModelId = process.env.EXTRACTION_MODEL ?? "anthropic/claude-3.5-haiku";
  const assistantModelId = process.env.ASSISTANT_MODEL ?? "anthropic/claude-3.5-haiku";
  const embeddingModelId = requireEnv("OPENROUTER_EMBEDDING_MODEL");
  const embeddingDimension = Number(requireEnv("EMBEDDING_DIMENSION"));
  const extractionStoreThreshold = Number(process.env.EXTRACTION_STORE_THRESHOLD ?? "0.3");
  const extractionDisplayThreshold = Number(process.env.EXTRACTION_DISPLAY_THRESHOLD ?? "0.5");

  const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
  const extractionModel = openrouter(extractionModelId, { plugins: [{ id: "response-healing" }] });
  const assistantModel = openrouter(assistantModelId, { plugins: [{ id: "response-healing" }] });
  const embeddingModel = openrouter.textEmbeddingModel(embeddingModelId);

  const config: ServerConfig = {
    openRouterApiKey,
    assistantModelId,
    extractionModelId,
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
    assistantModel,
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

export async function seedWorkspace(surreal: Surreal): Promise<{
  workspaceRecord: RecordId<"workspace", string>;
  conversationRecord: RecordId<"conversation", string>;
  ownerPersonCount: number;
}> {
  const now = new Date();
  const workspaceRecord = new RecordId("workspace", randomUUID());
  const conversationRecord = new RecordId("conversation", randomUUID());
  const ownerRecord = new RecordId("person", randomUUID());

  await surreal.create(workspaceRecord).content({
    name: `Eval ${Date.now()}`,
    status: "active",
    onboarding_complete: false,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
    updated_at: now,
  });

  await surreal.create(ownerRecord).content({
    name: "Marcus",
    created_at: now,
    updated_at: now,
  });

  await surreal.relate(ownerRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
    role: "owner",
    added_at: now,
  }).output("after");

  await surreal.create(conversationRecord).content({
    createdAt: now,
    updatedAt: now,
    workspace: workspaceRecord,
    source: "onboarding",
  });

  return { workspaceRecord, conversationRecord, ownerPersonCount: 1 };
}

export async function seedConversationContext(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
  context: Array<{ role: "user" | "assistant"; text: string }>,
): Promise<string[]> {
  const now = Date.now();
  const messageIds: string[] = [];
  for (const [index, message] of context.entries()) {
    const seededMessageRecord = new RecordId("message", randomUUID());
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
): Promise<RecordId<"message", string>> {
  const messageRecord = new RecordId("message", randomUUID());
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
