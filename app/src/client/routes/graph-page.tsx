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
      <section className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
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
    <section className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
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
      </div>

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
