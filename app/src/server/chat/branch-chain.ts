import { RecordId, type Surreal } from "surrealdb";

export type BranchLink = {
  conversationId: string;
  parentConversationId: string;
  branchPointMessageId: string;
  branchPointCreatedAt: Date;
};

export type InheritableMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
  inherited: boolean;
};

type MessageRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
};

/**
 * Walk branched_from edges from a conversation up to the root.
 * Returns an ordered array (root-first) of branch links.
 */
export async function loadBranchChain(
  surreal: Surreal,
  conversationId: string,
): Promise<BranchLink[]> {
  const chain: BranchLink[] = [];
  let current = conversationId;

  for (let depth = 0; depth < 10; depth++) {
    const conversationRecord = new RecordId("conversation", current);
    const [rows] = await surreal
      .query<[Array<{
        out: RecordId<"conversation", string>;
        branch_point_message: RecordId<"message", string>;
      }>]>(
        "SELECT out, branch_point_message FROM branched_from WHERE `in` = $conversation LIMIT 1;",
        { conversation: conversationRecord },
      )
      .collect<[Array<{
        out: RecordId<"conversation", string>;
        branch_point_message: RecordId<"message", string>;
      }>]>();

    if (rows.length === 0) break;

    const edge = rows[0];
    const branchPointMsg = await surreal.select<{ createdAt: Date | string }>(edge.branch_point_message);
    if (!branchPointMsg) {
      throw new Error(`branch point message not found: ${edge.branch_point_message.id as string}`);
    }

    chain.unshift({
      conversationId: current,
      parentConversationId: edge.out.id as string,
      branchPointMessageId: edge.branch_point_message.id as string,
      branchPointCreatedAt: branchPointMsg.createdAt instanceof Date
        ? branchPointMsg.createdAt
        : new Date(branchPointMsg.createdAt),
    });

    current = edge.out.id as string;
  }

  return chain;
}

/**
 * Load all messages for a conversation including inherited messages from ancestor branches.
 * Inherited messages are marked with `inherited: true`.
 */
export async function loadMessagesWithInheritance(
  surreal: Surreal,
  conversationId: string,
  limit: number,
): Promise<InheritableMessage[]> {
  const chain = await loadBranchChain(surreal, conversationId);

  if (chain.length === 0) {
    const messages = await queryConversationMessages(surreal, conversationId, limit);
    return messages.map((m) => toInheritable(m, false));
  }

  const allMessages: InheritableMessage[] = [];

  // Root conversation messages up to first branch point
  const rootConvId = chain[0].parentConversationId;
  const rootMessages = await queryMessagesUpToBranchPoint(
    surreal,
    rootConvId,
    chain[0].branchPointCreatedAt,
  );
  allMessages.push(...rootMessages.map((m) => toInheritable(m, true)));

  // Intermediate ancestor messages between branch points
  for (let i = 0; i < chain.length - 1; i++) {
    const intermediateMessages = await queryMessagesUpToBranchPoint(
      surreal,
      chain[i].conversationId,
      chain[i + 1].branchPointCreatedAt,
    );
    allMessages.push(...intermediateMessages.map((m) => toInheritable(m, true)));
  }

  // Current conversation's own messages
  const ownMessages = await queryConversationMessages(surreal, conversationId, limit);
  allMessages.push(...ownMessages.map((m) => toInheritable(m, false)));

  return allMessages;
}

function toInheritable(row: MessageRow, inherited: boolean): InheritableMessage {
  return {
    id: row.id.id as string,
    role: row.role,
    text: row.text,
    createdAt: row.createdAt,
    ...(row.suggestions && row.suggestions.length > 0 ? { suggestions: row.suggestions } : {}),
    inherited,
  };
}

async function queryConversationMessages(
  surreal: Surreal,
  conversationId: string,
  limit: number,
): Promise<MessageRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[MessageRow[]]>(
      "SELECT id, role, text, createdAt, suggestions FROM message WHERE conversation = $conversation ORDER BY createdAt ASC LIMIT $limit;",
      { conversation: conversationRecord, limit },
    )
    .collect<[MessageRow[]]>();
  return rows;
}

/**
 * Load messages from a conversation up to and including the branch point message
 * and its assistant response (the next message after the branch point).
 */
async function queryMessagesUpToBranchPoint(
  surreal: Surreal,
  conversationId: string,
  branchPointCreatedAt: Date,
): Promise<MessageRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);

  // Find the assistant response following the branch point (if any)
  const [nextRows] = await surreal
    .query<[MessageRow[]]>(
      "SELECT id, role, text, createdAt, suggestions FROM message WHERE conversation = $conversation AND createdAt > $branchPointAt ORDER BY createdAt ASC LIMIT 1;",
      { conversation: conversationRecord, branchPointAt: branchPointCreatedAt },
    )
    .collect<[MessageRow[]]>();

  const cutoffAt = nextRows.length > 0 && nextRows[0].role === "assistant"
    ? (nextRows[0].createdAt instanceof Date ? nextRows[0].createdAt : new Date(nextRows[0].createdAt as string))
    : branchPointCreatedAt;

  const [rows] = await surreal
    .query<[MessageRow[]]>(
      "SELECT id, role, text, createdAt, suggestions FROM message WHERE conversation = $conversation AND createdAt <= $cutoff ORDER BY createdAt ASC;",
      { conversation: conversationRecord, cutoff: cutoffAt },
    )
    .collect<[MessageRow[]]>();

  return rows;
}
