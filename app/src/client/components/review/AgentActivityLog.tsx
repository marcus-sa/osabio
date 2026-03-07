export type ActivityType = "tool_call" | "file_change" | "decision" | "error";

export interface ActivityEntry {
  timestamp: string;
  type: ActivityType;
  description: string;
}

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
    <div className={`activity-entry activity-entry--${entry.type}`}>
      <span className="activity-timestamp">{formatTimestamp(entry.timestamp)}</span>
      <span className="activity-indicator" title={indicator.label}>
        {indicator.icon}
      </span>
      <span className="activity-description">{entry.description}</span>
    </div>
  );
}

export function AgentActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <div className="activity-log activity-log--empty">No activity recorded</div>;
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return (
    <div className="activity-log">
      <h3 className="activity-log-title">Agent Activity</h3>
      <div className="activity-timeline">
        {sorted.map((entry, index) => (
          <ActivityItem key={index} entry={entry} />
        ))}
      </div>
    </div>
  );
}
