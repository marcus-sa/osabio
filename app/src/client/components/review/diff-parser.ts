export type FileStatus = "modified" | "new" | "deleted";

export interface DiffFileSection {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  lines: string[];
}

function detectStatus(headerLines: string[]): FileStatus {
  if (headerLines.some((l) => l.startsWith("new file mode"))) return "new";
  if (headerLines.some((l) => l.startsWith("deleted file mode"))) return "deleted";
  return "modified";
}

function extractPath(diffLine: string): string {
  // "diff --git a/src/main.ts b/src/main.ts" -> "src/main.ts"
  const match = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  return match ? match[2] : "";
}

function countChanges(lines: string[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function parseDiff(rawDiff: string): DiffFileSection[] {
  if (!rawDiff.trim()) return [];

  const fileDiffs = rawDiff.split(/^(?=diff --git )/m).filter((s) => s.trim());

  return fileDiffs.map((fileDiff) => {
    const allLines = fileDiff.split("\n");
    const diffLine = allLines[0];
    const path = extractPath(diffLine);

    // Header lines are between the diff line and the first hunk (@@)
    const firstHunkIndex = allLines.findIndex((l) => l.startsWith("@@"));
    const headerLines = firstHunkIndex > 0 ? allLines.slice(1, firstHunkIndex) : allLines.slice(1);
    const contentLines = firstHunkIndex > 0 ? allLines.slice(firstHunkIndex) : [];

    const status = detectStatus(headerLines);
    const { additions, deletions } = countChanges(contentLines);

    return { path, status, additions, deletions, lines: contentLines };
  });
}
