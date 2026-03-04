import { RecordId, type Surreal } from "surrealdb";
import { createDeterministicIdGenerator } from "./eval-test-kit";

export type ChatAgentSeedResult = {
  workspaceRecord: RecordId<"workspace", string>;
  ownerRecord: RecordId<"person", string>;
  projectRecords: RecordId<"project", string>[];
  conversationRecord: RecordId<"conversation", string>;
};

export async function seedChatAgentTestData(surreal: Surreal): Promise<ChatAgentSeedResult> {
  const nextId = createDeterministicIdGenerator("chat-agent-eval");
  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  // Workspace
  const workspaceRecord = new RecordId("workspace", nextId());
  await surreal.create(workspaceRecord).content({
    name: "Chat Agent Eval Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 5,
    onboarding_summary_pending: false,
    onboarding_started_at: oneMonthAgo,
    created_at: oneMonthAgo,
    updated_at: now,
  });

  // Owner
  const ownerRecord = new RecordId("person", nextId());
  await surreal.create(ownerRecord).content({
    name: "Marcus",
    created_at: oneMonthAgo,
    updated_at: now,
  });
  await surreal
    .relate(ownerRecord, new RecordId("member_of", nextId()), workspaceRecord, {
      role: "owner",
      added_at: oneMonthAgo,
    })
    .output("after");

  // Projects
  const projectAlpha = new RecordId("project", nextId());
  const projectBeta = new RecordId("project", nextId());
  for (const [record, name] of [
    [projectAlpha, "Project Alpha"],
    [projectBeta, "Project Beta"],
  ] as const) {
    await surreal.create(record).content({
      name,
      status: "active",
      workspace: workspaceRecord,
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(workspaceRecord, new RecordId("has_project", nextId()), record, {
        added_at: oneMonthAgo,
      })
      .output("after");
  }

  // Features (3 under Project Alpha)
  const featureNames = ["User Authentication", "Payment Processing", "Admin Dashboard"];
  const features: RecordId<"feature", string>[] = [];
  for (const name of featureNames) {
    const featureRecord = new RecordId("feature", nextId()) as RecordId<"feature", string>;
    await surreal.create(featureRecord).content({
      name,
      status: "active",
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(projectAlpha, new RecordId("has_feature", nextId()), featureRecord, {
        added_at: oneMonthAgo,
      })
      .output("after");
    features.push(featureRecord);
  }

  // Tasks (5 total: 3 open, 1 closed, 1 blocked)
  const taskData = [
    { title: "Implement login flow", status: "open", feature: features[0] },
    { title: "Add password reset", status: "open", feature: features[0] },
    { title: "Setup payment gateway", status: "open", feature: features[1] },
    { title: "Create DB schema", status: "closed", feature: features[1] },
    { title: "Build admin UI", status: "blocked", feature: features[2] },
  ];
  for (const task of taskData) {
    const taskRecord = new RecordId("task", nextId());
    await surreal.create(taskRecord).content({
      title: task.title,
      status: task.status,
      workspace: workspaceRecord,
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(taskRecord, new RecordId("belongs_to", nextId()), task.feature, {
        added_at: oneMonthAgo,
      })
      .output("after");
  }

  // Decisions (1 confirmed, 1 provisional)
  const decisionData = [
    { summary: "Use JWT for authentication tokens", status: "confirmed", date: oneMonthAgo },
    { summary: "Deploy to AWS ECS", status: "provisional", date: twoWeeksAgo },
  ];
  for (const decision of decisionData) {
    const decisionRecord = new RecordId("decision", nextId());
    await surreal.create(decisionRecord).content({
      summary: decision.summary,
      status: decision.status,
      workspace: workspaceRecord,
      created_at: decision.date,
      updated_at: decision.date,
    });
    await surreal
      .relate(decisionRecord, new RecordId("belongs_to", nextId()), projectAlpha, {
        added_at: decision.date,
      })
      .output("after");
  }

  // Open question
  const questionRecord = new RecordId("question", nextId());
  await surreal.create(questionRecord).content({
    text: "Which payment provider should we integrate with?",
    status: "open",
    workspace: workspaceRecord,
    created_at: now,
    updated_at: now,
  });
  await surreal
    .relate(questionRecord, new RecordId("belongs_to", nextId()), projectAlpha, {
      added_at: now,
    })
    .output("after");

  // Conversation
  const conversationRecord = new RecordId("conversation", nextId());
  await surreal.create(conversationRecord).content({
    createdAt: now,
    updatedAt: now,
    workspace: workspaceRecord,
    source: "chat",
  });

  return {
    workspaceRecord,
    ownerRecord,
    projectRecords: [projectAlpha, projectBeta],
    conversationRecord,
  };
}
