import { RecordId, type Surreal } from "surrealdb";
import { createDeterministicIdGenerator } from "./eval-test-kit";

export type AnalyticsSeedResult = {
  workspaceRecord: RecordId<"workspace", string>;
  projectRecords: RecordId<"project", string>[];
  taskCount: { open: number; closed: number; blocked: number };
  staleDecisionCount: number;
  openObservationCount: number;
};

export async function seedAnalyticsTestData(surreal: Surreal): Promise<AnalyticsSeedResult> {
  const nextId = createDeterministicIdGenerator("analytics-eval");
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Workspace
  const workspaceRecord = new RecordId("workspace", nextId());
  await surreal.create(workspaceRecord).content({
    name: "Analytics Eval Workspace",
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
    name: "Eval Owner",
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
  const projectA = new RecordId("project", nextId());
  const projectB = new RecordId("project", nextId());
  for (const [record, name] of [
    [projectA, "Project Alpha"],
    [projectB, "Project Beta"],
  ] as const) {
    await surreal.create(record).content({
      name,
      status: "active",
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(workspaceRecord, new RecordId("has_project", nextId()), record, {
        added_at: oneMonthAgo,
      })
      .output("after");
  }

  // Features (3 total, 2 for project A, 1 for project B)
  const features: RecordId<"feature", string>[] = [];
  const featureNames = ["Auth System", "Billing Module", "Dashboard"];
  const featureProjects = [projectA, projectA, projectB];
  for (let i = 0; i < 3; i++) {
    const featureRecord = new RecordId("feature", nextId()) as RecordId<"feature", string>;
    await surreal.create(featureRecord).content({
      name: featureNames[i],
      status: "active",
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(featureProjects[i], new RecordId("has_feature", nextId()), featureRecord, {
        added_at: oneMonthAgo,
      })
      .output("after");
    features.push(featureRecord);
  }

  // Tasks (10 total: 5 open, 3 closed, 2 blocked)
  const taskStatuses = ["open", "open", "open", "open", "open", "closed", "closed", "closed", "blocked", "blocked"];
  const taskTitles = [
    "Implement login flow",
    "Add password reset",
    "Write auth tests",
    "Design token refresh",
    "Document auth API",
    "Setup CI pipeline",
    "Create DB schema",
    "Configure linting",
    "Integrate payment gateway",
    "Build invoice generator",
  ];
  const taskFeatures = [features[0], features[0], features[0], features[0], features[0], features[1], features[1], features[1], features[2], features[2]];
  const tasks: RecordId<"task", string>[] = [];

  for (let i = 0; i < 10; i++) {
    const taskRecord = new RecordId("task", nextId()) as RecordId<"task", string>;
    await surreal.create(taskRecord).content({
      title: taskTitles[i],
      status: taskStatuses[i],
      created_at: oneMonthAgo,
      updated_at: now,
    });
    await surreal
      .relate(taskRecord, new RecordId("belongs_to", nextId()), taskFeatures[i], {
        added_at: oneMonthAgo,
      })
      .output("after");
    tasks.push(taskRecord);
  }

  // Dependency chain: task[8] depends on task[5], task[9] depends on task[8]
  await surreal
    .relate(tasks[8], new RecordId("depends_on", nextId()), tasks[5], { added_at: now })
    .output("after");
  await surreal
    .relate(tasks[9], new RecordId("depends_on", nextId()), tasks[8], { added_at: now })
    .output("after");

  // Decisions (5 total: 3 stale provisional, 2 confirmed)
  const decisionSummaries = [
    "Use JWT for authentication",
    "Deploy to AWS",
    "Use PostgreSQL for billing",
    "Adopt microservices architecture",
    "Use React for frontend",
  ];
  const decisionStatuses = ["provisional", "provisional", "provisional", "confirmed", "confirmed"];
  const decisionDates = [oneMonthAgo, twoWeeksAgo, oneMonthAgo, now, now];

  for (let i = 0; i < 5; i++) {
    const decisionRecord = new RecordId("decision", nextId());
    await surreal.create(decisionRecord).content({
      summary: decisionSummaries[i],
      status: decisionStatuses[i],
      created_at: decisionDates[i],
      updated_at: decisionDates[i],
    });
    await surreal
      .relate(decisionRecord, new RecordId("belongs_to", nextId()), projectA, {
        added_at: decisionDates[i],
      })
      .output("after");
  }

  // Observations (3 total: 2 open, 1 resolved)
  const observationTexts = [
    "Auth and billing timelines may conflict",
    "Dashboard feature lacks acceptance criteria",
    "CI pipeline latency resolved",
  ];
  const observationSeverities = ["warning", "info", "warning"];
  const observationStatuses = ["open", "open", "resolved"];

  for (let i = 0; i < 3; i++) {
    const obsRecord = new RecordId("observation", nextId());
    await surreal.create(obsRecord).content({
      text: observationTexts[i],
      severity: observationSeverities[i],
      status: observationStatuses[i],
      source_agent: "pm_agent",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    });
  }

  return {
    workspaceRecord,
    projectRecords: [projectA, projectB],
    taskCount: { open: 5, closed: 3, blocked: 2 },
    staleDecisionCount: 3,
    openObservationCount: 2,
  };
}
