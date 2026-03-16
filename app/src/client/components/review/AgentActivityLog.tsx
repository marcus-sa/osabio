import { cn } from "@/lib/utils";

export type ActivityType = "tool_call" | "file_change" | "decision" | "error";

export type ActivityEntry = {
  timestamp: string;
  type: ActivityType;
  description: string;
};

const TYPE_INDICATORS: Record<ActivityType, { icon: string; label: string }> = {
  tool_call: { icon: "\u2699", label: "Tool" },
  file_change: { icon: "\uD83D\uDCC4", label: "File" },
  decision: { icon: "\u2714", label: "Decision" },
  error: { icon: "\u26A0", label: "Error" },
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const indicator = TYPE_INDICATORS[entry.type];
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
      entry.type === "error" && "bg-destructive/10",
    )}>
      <span className="shrink-0 font-mono text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
      <span className="shrink-0" title={indicator.label}>{indicator.icon}</span>
      <span className="text-foreground">{entry.description}</span>
    </div>
  );
}

export function AgentActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground">No activity recorded</div>;
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Agent Activity</h3>
      <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-2">
        {sorted.map((entry, index) => (
          <ActivityItem key={index} entry={entry} />
        ))}
      </div>
    </div>
  );
}
