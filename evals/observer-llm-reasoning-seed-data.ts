import { RecordId, type Surreal } from "surrealdb";
import { createDeterministicIdGenerator } from "./eval-test-kit";

export type ObserverLlmSeedResult = {
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
  /** Decisions seeded in the project, keyed by case ID */
  decisions: Map<string, RecordId<"decision", string>>;
  /** Tasks seeded in the project, keyed by case ID */
  tasks: Map<string, RecordId<"task", string>>;
  /** Observations seeded by non-observer agents, keyed by case ID */
  observations: Map<string, RecordId<"observation", string>>;
};

export async function seedObserverLlmTestData(surreal: Surreal): Promise<ObserverLlmSeedResult> {
  const nextId = createDeterministicIdGenerator("observer-llm-eval");
  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  // Workspace
  const workspaceRecord = new RecordId("workspace", nextId()) as RecordId<"workspace", string>;
  await surreal.create(workspaceRecord).content({
    name: "Observer LLM Eval Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 5,
    onboarding_summary_pending: false,
    onboarding_started_at: oneMonthAgo,
    created_at: oneMonthAgo,
    updated_at: now,
  });

  // Owner identity (member_of requires identity, not person)
  const ownerRecord = new RecordId("identity", nextId());
  await surreal.create(ownerRecord).content({
    name: "Eval Owner",
    type: "human",
    workspace: workspaceRecord,
    identity_status: "active",
    created_at: oneMonthAgo,
  });
  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = $added_at;`,
    { identity: ownerRecord, workspace: workspaceRecord, added_at: oneMonthAgo },
  );

  // Project
  const projectRecord = new RecordId("project", nextId()) as RecordId<"project", string>;
  await surreal.create(projectRecord).content({
    name: "Platform Modernization",
    status: "active",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: now,
  });
  await surreal
    .relate(workspaceRecord, new RecordId("has_project", nextId()), projectRecord, {
      added_at: oneMonthAgo,
    })
    .output("after");

  const decisions = new Map<string, RecordId<"decision", string>>();
  const tasks = new Map<string, RecordId<"task", string>>();
  const observations = new Map<string, RecordId<"observation", string>>();

  // ---------------------------------------------------------------------------
  // Verification eval cases: decisions + tasks
  // ---------------------------------------------------------------------------

  // Case: clear-contradiction — Decision says no external deps, task adds Redis + Kafka
  const decNoDeps = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decNoDeps).content({
    summary: "Minimize external service dependencies. Prefer in-process alternatives over cloud services. No new external dependencies without explicit approval.",
    rationale: "Reduce operational complexity and failure surface area",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decNoDeps, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("clear-contradiction", decNoDeps);

  const taskRedisKafka = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskRedisKafka).content({
    title: "Add Redis caching layer and Kafka event stream for session management",
    description: "Integrate Redis for distributed caching and Kafka for async event processing. Both are new external service dependencies requiring infrastructure provisioning.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskRedisKafka, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("clear-contradiction", taskRedisKafka);

  // Case: clear-match — Decision says use TypeScript, task uses TypeScript
  const decTypescript = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decTypescript).content({
    summary: "Use TypeScript for all backend services. No plain JavaScript files in production code.",
    rationale: "Type safety and maintainability across the codebase",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decTypescript, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("clear-match", decTypescript);

  const taskTsMiddleware = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskTsMiddleware).content({
    title: "Implement authentication middleware in TypeScript",
    description: "Build JWT authentication middleware using TypeScript with strict type checking and comprehensive test coverage.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskTsMiddleware, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("clear-match", taskTsMiddleware);

  // Case: api-contradiction — Decision says tRPC, task uses REST
  const decTrpc = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decTrpc).content({
    summary: "Standardize on tRPC for all new API endpoints. REST and GraphQL are forbidden for new services.",
    rationale: "End-to-end type safety and reduced boilerplate",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decTrpc, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("api-contradiction", decTrpc);

  const taskRestBilling = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskRestBilling).content({
    title: "Implement billing API with REST endpoints using Express",
    description: "Build a RESTful billing API with Express routes for payment processing, invoice generation, and subscription management. Uses standard REST conventions.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskRestBilling, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("api-contradiction", taskRestBilling);

  // Case: ambiguous — Decision is loosely related, task is tangential
  const decConvention = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decConvention).content({
    summary: "Prefer convention over configuration for internal tooling",
    rationale: "Reduce onboarding friction for new team members",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decConvention, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("ambiguous", decConvention);

  const taskLinterConfig = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskLinterConfig).content({
    title: "Add ESLint configuration file for project-specific rules",
    description: "Create .eslintrc with linting rules tailored to the project's coding standards.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskLinterConfig, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("ambiguous", taskLinterConfig);

  // Case: security-contradiction — Decision says parameterized queries, task uses string concat
  const decParamQueries = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decParamQueries).content({
    summary: "All database queries must use parameterized statements. No string concatenation in SQL queries under any circumstances.",
    rationale: "SQL injection prevention and security compliance",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decParamQueries, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("security-contradiction", decParamQueries);

  const taskDynamicSql = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskDynamicSql).content({
    title: "Build admin search with dynamic SQL string construction",
    description: "Implement admin search by building SQL queries via string concatenation based on user-provided filter parameters for flexible querying.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskDynamicSql, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("security-contradiction", taskDynamicSql);

  // Case: format-contradiction — Decision says JSON only, task outputs XML
  const decJsonOnly = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decJsonOnly).content({
    summary: "All API responses must use JSON format exclusively. No XML, HTML, or plain text responses from any endpoint.",
    rationale: "Consistent API contract for all consumers",
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decJsonOnly, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("format-contradiction", decJsonOnly);

  const taskXmlExport = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskXmlExport).content({
    title: "Implement XML export endpoint for legacy ERP integration",
    description: "Build an endpoint that returns XML-formatted data for the legacy ERP system. The ERP only accepts XML payloads.",
    status: "completed",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskXmlExport, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("format-contradiction", taskXmlExport);

  // ---------------------------------------------------------------------------
  // Peer review eval cases: observations from non-observer agents
  // ---------------------------------------------------------------------------

  // Case: grounded-warning — PM observation with valid evidence
  const taskRateLimit = new RecordId("task", nextId()) as RecordId<"task", string>;
  await surreal.create(taskRateLimit).content({
    title: "Implement rate limiting middleware",
    description: "Add request rate limiting to protect API endpoints from abuse",
    status: "in_progress",
    workspace: workspaceRecord,
    created_at: twoWeeksAgo,
    updated_at: now,
  });
  await surreal
    .relate(taskRateLimit, new RecordId("belongs_to", nextId()), projectRecord, { added_at: twoWeeksAgo })
    .output("after");
  tasks.set("grounded-warning", taskRateLimit);

  // Provisional decision referenced by the grounded observation
  const decApiQuota = new RecordId("decision", nextId()) as RecordId<"decision", string>;
  await surreal.create(decApiQuota).content({
    summary: "Enforce API quota limits per tenant to prevent abuse and ensure fair resource allocation",
    rationale: "Multiple incidents of single tenants consuming excessive API resources",
    status: "provisional",
    workspace: workspaceRecord,
    created_at: oneMonthAgo,
    updated_at: oneMonthAgo,
  });
  await surreal
    .relate(decApiQuota, new RecordId("belongs_to", nextId()), projectRecord, { added_at: oneMonthAgo })
    .output("after");
  decisions.set("grounded-warning-decision", decApiQuota);

  const obsGrounded = new RecordId("observation", nextId()) as RecordId<"observation", string>;
  await surreal.create(obsGrounded).content({
    text: "Task 'implement rate limiting' has been in_progress for 15 days with no linked commits. The related decision about API quota enforcement is still provisional after 30 days. This combination suggests the task may be blocked by an unresolved decision.",
    severity: "warning",
    status: "open",
    source_agent: "pm_agent",
    workspace: workspaceRecord,
    created_at: now,
    updated_at: now,
  });
  await surreal
    .relate(obsGrounded, new RecordId("observes", nextId()), taskRateLimit, { added_at: now })
    .output("after");
  await surreal
    .relate(obsGrounded, new RecordId("observes", nextId()), decApiQuota, { added_at: now })
    .output("after");
  observations.set("grounded-warning", obsGrounded);

  // Case: ungrounded-claim — PM observation with weak/no evidence
  const obsUngrounded = new RecordId("observation", nextId()) as RecordId<"observation", string>;
  await surreal.create(obsUngrounded).content({
    text: "The entire authentication system is fundamentally broken and needs a complete rewrite from scratch. All security measures are inadequate.",
    severity: "conflict",
    status: "open",
    source_agent: "pm_agent",
    workspace: workspaceRecord,
    created_at: now,
    updated_at: now,
  });
  // No observes edges — weak evidence
  observations.set("ungrounded-claim", obsUngrounded);

  return {
    workspaceRecord,
    projectRecord,
    decisions,
    tasks,
    observations,
  };
}
