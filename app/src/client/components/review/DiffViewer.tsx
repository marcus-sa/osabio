import { useState } from "react";
import { parseDiff, type DiffFileSection } from "./diff-parser";

function FileStatusBadge({ status }: { status: DiffFileSection["status"] }) {
  const labels: Record<DiffFileSection["status"], string> = {
    modified: "M",
    new: "A",
    deleted: "D",
  };
  return <span className={`diff-file-status diff-file-status--${status}`}>{labels[status]}</span>;
}

function DiffLine({ line }: { line: string }) {
  const lineType = line.startsWith("+")
    ? "addition"
    : line.startsWith("-")
      ? "deletion"
      : line.startsWith("@@")
        ? "hunk-header"
        : "context";
  return <div className={`diff-line diff-line--${lineType}`}>{line}</div>;
}

function FileSection({ section }: { section: DiffFileSection }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="diff-file-section">
      <button
        type="button"
        className="diff-file-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="diff-file-toggle">{expanded ? "\u25BC" : "\u25B6"}</span>
        <FileStatusBadge status={section.status} />
        <span className="diff-file-path">{section.path}</span>
        <span className="diff-file-stats">
          {section.additions > 0 && (
            <span className="diff-stat-additions">+{section.additions}</span>
          )}
          {section.deletions > 0 && (
            <span className="diff-stat-deletions">-{section.deletions}</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="diff-file-content">
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
    return <div className="diff-viewer diff-viewer--empty">No changes</div>;
  }

  const totalAdditions = sections.reduce((sum, s) => sum + s.additions, 0);
  const totalDeletions = sections.reduce((sum, s) => sum + s.deletions, 0);

  return (
    <div className="diff-viewer">
      <div className="diff-summary">
        <span className="diff-summary-files">{sections.length} files changed</span>
        <span className="diff-stat-additions">+{totalAdditions}</span>
        <span className="diff-stat-deletions">-{totalDeletions}</span>
      </div>
      <div className="diff-file-list">
        {sections.map((section) => (
          <FileSection key={section.path} section={section} />
        ))}
      </div>
    </div>
  );
}
