import { useState } from "react";
import { parseDiff, type DiffFileSection } from "./diff-parser";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

function FileStatusBadge({ status }: { status: DiffFileSection["status"] }) {
  const config: Record<DiffFileSection["status"], { label: string; variant: "default" | "secondary" | "destructive" }> = {
    modified: { label: "M", variant: "secondary" },
    new: { label: "A", variant: "default" },
    deleted: { label: "D", variant: "destructive" },
  };
  const c = config[status];
  return <Badge variant={c.variant} className="h-4 px-1 text-[0.6rem]">{c.label}</Badge>;
}

function DiffLine({ line }: { line: string }) {
  const lineType = line.startsWith("+")
    ? "addition"
    : line.startsWith("-")
      ? "deletion"
      : line.startsWith("@@")
        ? "hunk-header"
        : "context";
  return (
    <div className={cn(
      "px-2 font-mono text-[0.7rem] leading-5",
      lineType === "addition" && "bg-entity-feature-muted text-entity-feature-fg",
      lineType === "deletion" && "bg-destructive/10 text-destructive",
      lineType === "hunk-header" && "bg-muted text-muted-foreground",
      lineType === "context" && "text-muted-foreground",
    )}>
      {line}
    </div>
  );
}

function FileSection({ section }: { section: DiffFileSection }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 bg-muted px-2 py-1.5 text-left text-xs hover:bg-hover"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="text-muted-foreground">{expanded ? "\u25BC" : "\u25B6"}</span>
        <FileStatusBadge status={section.status} />
        <span className="flex-1 font-mono text-foreground">{section.path}</span>
        <span className="flex gap-1.5">
          {section.additions > 0 && (
            <span className="text-entity-feature-fg">+{section.additions}</span>
          )}
          {section.deletions > 0 && (
            <span className="text-destructive">-{section.deletions}</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          {section.lines.map((line, index) => (
            <DiffLine key={index} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ rawDiff }: { rawDiff: string }) {
  const sections = parseDiff(rawDiff);

  if (sections.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground">No changes</div>;
  }

  const totalAdditions = sections.reduce((sum, s) => sum + s.additions, 0);
  const totalDeletions = sections.reduce((sum, s) => sum + s.deletions, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{sections.length} files changed</span>
        <span className="text-entity-feature-fg">+{totalAdditions}</span>
        <span className="text-destructive">-{totalDeletions}</span>
      </div>
      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <FileSection key={section.path} section={section} />
        ))}
      </div>
    </div>
  );
}
