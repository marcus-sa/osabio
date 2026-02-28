import { useCallback, useEffect, useState } from "react";
import type { GraphCanvasRef } from "reagraph";

type ProjectOption = {
  id: string;
  name: string;
};

export function GraphToolbar({
  workspaceId,
  viewMode,
  projectId,
  depth,
  onViewModeChange,
  onProjectChange,
  onDepthChange,
  graphRef,
}: {
  workspaceId: string;
  viewMode: "project" | "focused";
  projectId: string | undefined;
  depth: number;
  onViewModeChange: (mode: "project" | "focused") => void;
  onProjectChange: (projectId: string) => void;
  onDepthChange: (depth: number) => void;
  graphRef?: React.RefObject<GraphCanvasRef | null>;
}) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sidebar`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        const groups = (data.groups ?? []) as Array<{ projectId: string; projectName: string }>;
        setProjects(groups.map((g) => ({ id: g.projectId, name: g.projectName })));
      })
      .catch(() => {});
  }, [workspaceId]);

  const handleFit = useCallback(() => {
    graphRef?.current?.fitNodesInView();
  }, [graphRef]);

  return (
    <div className="graph-toolbar">
      <select
        value={projectId ?? ""}
        onChange={(e) => {
          if (e.target.value) {
            onProjectChange(e.target.value);
          }
        }}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={viewMode}
        onChange={(e) => onViewModeChange(e.target.value as "project" | "focused")}
      >
        <option value="project">Project view</option>
        <option value="focused">Focused view</option>
      </select>

      {viewMode === "focused" ? (
        <label>
          Depth
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={depth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
          />
          <span>{depth}</span>
        </label>
      ) : undefined}

      <button type="button" onClick={handleFit}>
        Fit
      </button>
    </div>
  );
}
