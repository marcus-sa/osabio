import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { loadBranchChain, loadMessagesWithInheritance } from "../../../app/src/server/chat/branch-chain";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `branch_test_${runId}`;
  database = `branch_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  const schema = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schema);
}, 30_000);

afterAll(async () => {
  try { await surreal.query(`REMOVE DATABASE ${database};`); } catch {}
  try { await surreal.query(`REMOVE NAMESPACE ${namespace};`); } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

// ── Helpers ──

function ts(base: number, offsetMs: number): Date {
  return new Date(base + offsetMs);
}

async function createConversation(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await surreal.query("CREATE $record CONTENT $content;", {
    record: new RecordId("conversation", id),
    content: {
      createdAt: now,
      updatedAt: now,
      workspace: new RecordId("workspace", "test-ws"),
      title: "test",
      title_source: "message",
    },
  });
  return id;
}

async function insertMsg(
  conversationId: string,
  role: "user" | "assistant",
  text: string,
  createdAt: Date,
): Promise<string> {
  const id = randomUUID();
  await surreal.query("CREATE $record CONTENT $content;", {
    record: new RecordId("message", id),
    content: {
      conversation: new RecordId("conversation", conversationId),
      role,
      text,
      createdAt,
    },
  });
  return id;
}

async function relateBranch(
  childConvId: string,
  parentConvId: string,
  branchPointMsgId: string,
): Promise<void> {
  await surreal.query(
    "RELATE $child->branched_from->$parent SET branched_at = time::now(), branch_point_message = $msg;",
    {
      child: new RecordId("conversation", childConvId),
      parent: new RecordId("conversation", parentConvId),
      msg: new RecordId("message", branchPointMsgId),
    },
  );
}

// ── Tests ──

describe("branch inheritance", () => {
  it("branch includes inherited messages up to branch point + assistant response", async () => {
    const rootId = await createConversation();
    const base = Date.now();

    // Root: user1, assistant1, user2, assistant2, user3
    await insertMsg(rootId, "user", "Root user 1", ts(base, 1000));
    await insertMsg(rootId, "assistant", "Root assistant 1", ts(base, 2000));
    const branchPointId = await insertMsg(rootId, "user", "Root user 2", ts(base, 3000));
    await insertMsg(rootId, "assistant", "Root assistant 2", ts(base, 4000));
    await insertMsg(rootId, "user", "Root user 3 (after branch)", ts(base, 5000));

    // Branch from user2 — should inherit user1, assistant1, user2, assistant2
    const branchId = await createConversation();
    await relateBranch(branchId, rootId, branchPointId);

    await insertMsg(branchId, "user", "Branch user 1", ts(base, 10000));
    await insertMsg(branchId, "assistant", "Branch assistant 1", ts(base, 11000));

    // Verify chain
    const chain = await loadBranchChain(surreal, branchId);
    expect(chain).toHaveLength(1);
    expect(chain[0].parentConversationId).toBe(rootId);
    expect(chain[0].conversationId).toBe(branchId);
    expect(chain[0].branchPointMessageId).toBe(branchPointId);

    // Verify inherited messages
    const messages = await loadMessagesWithInheritance(surreal, branchId, 50);
    const inherited = messages.filter((m) => m.inherited);
    const own = messages.filter((m) => !m.inherited);

    const inheritedTexts = inherited.map((m) => m.text);
    expect(inheritedTexts).toContain("Root user 1");
    expect(inheritedTexts).toContain("Root assistant 1");
    expect(inheritedTexts).toContain("Root user 2");
    expect(inheritedTexts).toContain("Root assistant 2");
    expect(inheritedTexts).not.toContain("Root user 3 (after branch)");
    expect(inherited).toHaveLength(4);

    const ownTexts = own.map((m) => m.text);
    expect(ownTexts).toEqual(["Branch user 1", "Branch assistant 1"]);

    // Chronological order
    for (let i = 1; i < messages.length; i++) {
      const prev = new Date(messages[i - 1].createdAt).getTime();
      const curr = new Date(messages[i].createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("multi-level branching (root → A → B) inherits from all ancestors", async () => {
    const rootId = await createConversation();
    const base = Date.now();

    // Root: 2 pairs
    const rootMsg1 = await insertMsg(rootId, "user", "Root msg 1", ts(base, 1000));
    await insertMsg(rootId, "assistant", "Root reply 1", ts(base, 2000));
    await insertMsg(rootId, "user", "Root msg 2", ts(base, 3000));
    await insertMsg(rootId, "assistant", "Root reply 2", ts(base, 4000));

    // Branch A from rootMsg1
    const branchAId = await createConversation();
    await relateBranch(branchAId, rootId, rootMsg1);

    const branchAMsg1 = await insertMsg(branchAId, "user", "A msg 1", ts(base, 10000));
    await insertMsg(branchAId, "assistant", "A reply 1", ts(base, 11000));
    await insertMsg(branchAId, "user", "A msg 2", ts(base, 12000));
    await insertMsg(branchAId, "assistant", "A reply 2", ts(base, 13000));

    // Branch B from branchAMsg1
    const branchBId = await createConversation();
    await relateBranch(branchBId, branchAId, branchAMsg1);

    await insertMsg(branchBId, "user", "B msg 1", ts(base, 20000));
    await insertMsg(branchBId, "assistant", "B reply 1", ts(base, 21000));

    // ── Verify chain for B ──
    const chain = await loadBranchChain(surreal, branchBId);
    expect(chain).toHaveLength(2);
    // Root-first order
    expect(chain[0].parentConversationId).toBe(rootId);
    expect(chain[0].conversationId).toBe(branchAId);
    expect(chain[1].parentConversationId).toBe(branchAId);
    expect(chain[1].conversationId).toBe(branchBId);

    // ── Verify Branch A messages ──
    const msgsA = await loadMessagesWithInheritance(surreal, branchAId, 50);
    const inheritedA = msgsA.filter((m) => m.inherited).map((m) => m.text);
    const ownA = msgsA.filter((m) => !m.inherited).map((m) => m.text);

    expect(inheritedA).toContain("Root msg 1");
    expect(inheritedA).toContain("Root reply 1");
    expect(inheritedA).not.toContain("Root msg 2");
    expect(inheritedA).not.toContain("Root reply 2");
    expect(ownA).toEqual(["A msg 1", "A reply 1", "A msg 2", "A reply 2"]);

    // ── Verify Branch B messages (multi-level) ──
    const msgsB = await loadMessagesWithInheritance(surreal, branchBId, 50);
    const inheritedB = msgsB.filter((m) => m.inherited).map((m) => m.text);
    const ownB = msgsB.filter((m) => !m.inherited).map((m) => m.text);

    // From root: msg1 + reply1 (branch A's branch point)
    expect(inheritedB).toContain("Root msg 1");
    expect(inheritedB).toContain("Root reply 1");
    expect(inheritedB).not.toContain("Root msg 2");
    expect(inheritedB).not.toContain("Root reply 2");

    // From branch A: msg1 + reply1 (branch B's branch point)
    expect(inheritedB).toContain("A msg 1");
    expect(inheritedB).toContain("A reply 1");
    expect(inheritedB).not.toContain("A msg 2");
    expect(inheritedB).not.toContain("A reply 2");

    // Own
    expect(ownB).toEqual(["B msg 1", "B reply 1"]);

    // Total: root(2) + A(2) inherited, B(2) own
    expect(msgsB).toHaveLength(6);

    // Chronological order across the full chain
    for (let i = 1; i < msgsB.length; i++) {
      const prev = new Date(msgsB[i - 1].createdAt).getTime();
      const curr = new Date(msgsB[i].createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("root conversation with no branches returns all messages as non-inherited", async () => {
    const convId = await createConversation();
    const base = Date.now();

    await insertMsg(convId, "user", "Hello", ts(base, 1000));
    await insertMsg(convId, "assistant", "Hi there", ts(base, 2000));

    const chain = await loadBranchChain(surreal, convId);
    expect(chain).toHaveLength(0);

    const messages = await loadMessagesWithInheritance(surreal, convId, 50);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => !m.inherited)).toBe(true);
  });
});
