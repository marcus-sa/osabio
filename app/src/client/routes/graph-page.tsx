import { useViewState } from "../stores/view-state";
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import { EntityDetailPanel } from "../components/graph/EntityDetailPanel";

const ACTIVE_WORKSPACE_STORAGE_KEY = "brain.activeWorkspaceId";

export function GraphPage() {
  const workspaceId = typeof window !== "undefined"
    ? window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? undefined
    : undefined;

  const {
    selectedEntityId,
    graphViewMode,
    graphProjectId,
    graphCenterId,
    graphDepth,
    selectEntity,
    setGraphViewMode,
    setGraphProject,
    setGraphDepth,
    navigateToGraph,
  } = useViewState();

  if (!workspaceId) {
    return (
      <section className="graph-page">
        <div className="graph-empty">
          <p>No workspace selected. Create a workspace from the Chat view first.</p>
        </div>
      </section>
    );
  }

  const hasPanel = selectedEntityId !== undefined;

  function handleNodeClick(nodeId: string) {
    selectEntity(nodeId);
  }

  function handleEntityClickInPanel(entityId: string) {
    navigateToGraph(entityId);
  }

  return (
    <section className={`graph-page${hasPanel ? " graph-page--with-panel" : ""}`}>
      <GraphToolbar
        workspaceId={workspaceId}
        viewMode={graphViewMode}
        projectId={graphProjectId}
        depth={graphDepth}
        onViewModeChange={setGraphViewMode}
        onProjectChange={setGraphProject}
        onDepthChange={setGraphDepth}
      />

      <KnowledgeGraph
        workspaceId={workspaceId}
        projectId={graphViewMode === "project" ? graphProjectId : undefined}
        centerId={graphViewMode === "focused" ? graphCenterId : undefined}
        depth={graphDepth}
        selectedId={selectedEntityId}
        onNodeClick={handleNodeClick}
      />

      {hasPanel ? (
        <EntityDetailPanel
          entityId={selectedEntityId}
          workspaceId={workspaceId}
          onClose={() => selectEntity(undefined)}
          onEntityClick={handleEntityClickInPanel}
        />
      ) : undefined}
    </section>
  );
}
