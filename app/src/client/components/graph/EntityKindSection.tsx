import type { EntityKind } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";
import { StatusBadge } from "../ui/status-badge";

type EntityKindSectionProps = {
  kind: EntityKind;
  data: Record<string, unknown>;
  onEntityClick?: (entityId: string) => void;
};

const EVIDENCE_KINDS = new Set<EntityKind>(["observation", "learning", "git_commit", "intent"]);

function ObservationSection({ data }: { data: Record<string, unknown> }) {
  const text = data.text as string | undefined;
  const severity = data.severity as string | undefined;
  const status = data.status as string | undefined;
  const sourceAgent = data.source_agent as string | undefined;
  const observationType = data.observation_type as string | undefined;

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observation</h4>
      {text ? <p className="text-xs leading-relaxed text-card-foreground">{text}</p> : undefined}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {severity ? (
          <>
            <dt className="text-muted-foreground">Severity</dt>
            <dd><StatusBadge status={severity} /></dd>
          </>
        ) : undefined}
        {status ? (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusBadge status={status} /></dd>
          </>
        ) : undefined}
        {observationType ? (
          <>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-foreground">{observationType}</dd>
          </>
        ) : undefined}
        {sourceAgent ? (
          <>
            <dt className="text-muted-foreground">Source Agent</dt>
            <dd className="text-foreground">{sourceAgent}</dd>
          </>
        ) : undefined}
      </dl>
    </div>
  );
}

function LearningSection({ data }: { data: Record<string, unknown> }) {
  const text = data.text as string | undefined;
  const learningType = data.learning_type as string | undefined;
  const status = data.status as string | undefined;
  const source = data.source as string | undefined;

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Learning</h4>
      {text ? <p className="text-xs leading-relaxed text-card-foreground">{text}</p> : undefined}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {learningType ? (
          <>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-foreground">{learningType}</dd>
          </>
        ) : undefined}
        {status ? (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusBadge status={status} /></dd>
          </>
        ) : undefined}
        {source ? (
          <>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="text-foreground">{source}</dd>
          </>
        ) : undefined}
      </dl>
    </div>
  );
}

function GitCommitSection({ data }: { data: Record<string, unknown> }) {
  const message = data.message as string | undefined;
  const sha = data.sha as string | undefined;
  const authorName = data.author_name as string | undefined;
  const repository = data.repository as string | undefined;

  const truncatedSha = sha ? sha.slice(0, 7) : undefined;

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commit</h4>
      {message ? <p className="text-xs leading-relaxed text-card-foreground">{message}</p> : undefined}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {truncatedSha ? (
          <>
            <dt className="text-muted-foreground">SHA</dt>
            <dd className="font-mono text-foreground">{truncatedSha}</dd>
          </>
        ) : undefined}
        {authorName ? (
          <>
            <dt className="text-muted-foreground">Author</dt>
            <dd className="text-foreground">{authorName}</dd>
          </>
        ) : undefined}
        {repository ? (
          <>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="text-foreground">{repository}</dd>
          </>
        ) : undefined}
      </dl>
    </div>
  );
}

type ResolvedEvidenceRef = { table: string; id: string; name: string };

function parseEvidenceRef(ref: unknown): ResolvedEvidenceRef {
  if (typeof ref === "object" && ref !== null && "table" in ref && "name" in ref) {
    const obj = ref as { table: string; id: string; name: string };
    return { table: obj.table, id: obj.id, name: obj.name };
  }
  if (typeof ref === "string") {
    const colonIdx = ref.indexOf(":");
    if (colonIdx === -1) return { table: "unknown", id: ref, name: ref };
    const table = ref.slice(0, colonIdx);
    const rawId = ref.slice(colonIdx + 1).replace(/^[`\u27e8]|[`\u27e9]$/g, "");
    return { table, id: rawId, name: rawId };
  }
  const obj = ref as { tb?: string; id?: string; table?: { name?: string } };
  const id = typeof obj.id === "string" ? obj.id : String(obj.id ?? "");
  return {
    table: obj.tb ?? obj.table?.name ?? "unknown",
    id,
    name: id,
  };
}

function EvidenceRefsSection({ refs, onEntityClick }: { refs: unknown[]; onEntityClick?: (entityId: string) => void }) {
  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence References</h4>
      <div className="flex flex-col gap-0.5">
        {refs.map((ref, i) => {
          const { table, id, name } = parseEvidenceRef(ref);
          return (
            <button
              key={i}
              type="button"
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-foreground transition-colors hover:bg-hover"
              onClick={() => onEntityClick?.(`${table}:${id}`)}
            >
              <EntityBadge kind={table as EntityKind} />
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceVerificationSection({ verification }: { verification: Record<string, unknown> }) {
  const verified = verification.verified_count as number | undefined;
  const total = verification.total_count as number | undefined;
  const mode = verification.enforcement_mode as string | undefined;
  const tierMet = verification.tier_met as boolean | undefined;
  const timeMs = verification.verification_time_ms as number | undefined;
  const authorCount = verification.independent_author_count as number | undefined;
  const failedRefs = verification.failed_refs as string[] | undefined;
  const warnings = verification.warnings as string[] | undefined;

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence Verification</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {verified !== undefined && total !== undefined ? (
          <>
            <dt className="text-muted-foreground">Verified</dt>
            <dd className="text-foreground">{verified} / {total}</dd>
          </>
        ) : undefined}
        {mode ? (
          <>
            <dt className="text-muted-foreground">Mode</dt>
            <dd><StatusBadge status={mode} /></dd>
          </>
        ) : undefined}
        {tierMet !== undefined ? (
          <>
            <dt className="text-muted-foreground">Tier Met</dt>
            <dd className={tierMet ? "text-green-500" : "text-red-500"}>{tierMet ? "Yes" : "No"}</dd>
          </>
        ) : undefined}
        {authorCount !== undefined ? (
          <>
            <dt className="text-muted-foreground">Authors</dt>
            <dd className="text-foreground">{authorCount}</dd>
          </>
        ) : undefined}
        {timeMs !== undefined ? (
          <>
            <dt className="text-muted-foreground">Time</dt>
            <dd className="text-foreground">{timeMs}ms</dd>
          </>
        ) : undefined}
      </dl>
      {failedRefs && failedRefs.length > 0 ? (
        <div className="mt-1">
          <p className="text-[10px] font-medium text-red-500">Failed refs:</p>
          {failedRefs.map((r, i) => (
            <p key={i} className="truncate font-mono text-[10px] text-red-400">{r}</p>
          ))}
        </div>
      ) : undefined}
      {warnings && warnings.length > 0 ? (
        <div className="mt-1">
          <p className="text-[10px] font-medium text-yellow-500">Warnings:</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-yellow-400">{w}</p>
          ))}
        </div>
      ) : undefined}
    </div>
  );
}

function IntentSection({ data }: { data: Record<string, unknown> }) {
  const goal = data.goal as string | undefined;
  const status = data.status as string | undefined;
  const priority = data.priority as number | undefined;
  const actionSpec = data.action_spec as { action?: string; provider?: string } | undefined;
  const budgetLimit = data.budget_limit as { amount?: number; currency?: string } | undefined;
  const vetoReason = data.veto_reason as string | undefined;
  const errorReason = data.error_reason as string | undefined;

  return (
    <div className="flex flex-col gap-2 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intent</h4>
      {goal ? <p className="text-xs leading-relaxed text-card-foreground">{goal}</p> : undefined}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {status ? (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusBadge status={status} /></dd>
          </>
        ) : undefined}
        {priority !== undefined ? (
          <>
            <dt className="text-muted-foreground">Priority</dt>
            <dd className="text-foreground">{priority}</dd>
          </>
        ) : undefined}
        {actionSpec?.action ? (
          <>
            <dt className="text-muted-foreground">Action</dt>
            <dd className="text-foreground">{actionSpec.action}</dd>
          </>
        ) : undefined}
        {actionSpec?.provider ? (
          <>
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="text-foreground">{actionSpec.provider}</dd>
          </>
        ) : undefined}
        {budgetLimit?.amount !== undefined ? (
          <>
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="text-foreground">
              {new Intl.NumberFormat(undefined, { style: "currency", currency: budgetLimit.currency ?? "USD" }).format(budgetLimit.amount)}
            </dd>
          </>
        ) : undefined}
      </dl>
      {vetoReason ? (
        <p className="text-xs text-red-400"><span className="font-medium">Veto:</span> {vetoReason}</p>
      ) : undefined}
      {errorReason ? (
        <p className="text-xs text-red-400"><span className="font-medium">Error:</span> {errorReason}</p>
      ) : undefined}
    </div>
  );
}

export function EntityKindSection({ kind, data, onEntityClick }: EntityKindSectionProps) {
  if (!EVIDENCE_KINDS.has(kind)) return <></>;

  switch (kind) {
    case "observation": return <ObservationSection data={data} />;
    case "learning": return <LearningSection data={data} />;
    case "git_commit": return <GitCommitSection data={data} />;
    case "intent": {
      const evidenceRefs = data.evidence_refs as unknown[] | undefined;
      const evidenceVerification = data.evidence_verification as Record<string, unknown> | undefined;
      return (
        <>
          <IntentSection data={data} />
          {evidenceRefs && evidenceRefs.length > 0 ? <EvidenceRefsSection refs={evidenceRefs} onEntityClick={onEntityClick} /> : undefined}
          {evidenceVerification ? <EvidenceVerificationSection verification={evidenceVerification} /> : undefined}
        </>
      );
    }
    default: return <></>;
  }
}
