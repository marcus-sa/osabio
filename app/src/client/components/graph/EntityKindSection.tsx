import type { EntityKind } from "../../../shared/contracts";
import { StatusBadge } from "../ui/status-badge";

type EntityKindSectionProps = {
  kind: EntityKind;
  data: Record<string, unknown>;
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

function IntentSection({ data }: { data: Record<string, unknown> }) {
  const goal = data.goal as string | undefined;
  const status = data.status as string | undefined;

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intent</h4>
      {goal ? <p className="text-xs leading-relaxed text-card-foreground">{goal}</p> : undefined}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {status ? (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusBadge status={status} /></dd>
          </>
        ) : undefined}
      </dl>
    </div>
  );
}

export function EntityKindSection({ kind, data }: EntityKindSectionProps) {
  if (!EVIDENCE_KINDS.has(kind)) return <></>;

  switch (kind) {
    case "observation": return <ObservationSection data={data} />;
    case "learning": return <LearningSection data={data} />;
    case "git_commit": return <GitCommitSection data={data} />;
    case "intent": return <IntentSection data={data} />;
    default: return <></>;
  }
}
