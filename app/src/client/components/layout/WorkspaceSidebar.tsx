import type { ConversationSidebarItem, WorkspaceConversationSidebarResponse } from "../../../shared/contracts";

type WorkspaceSidebarProps = {
  sidebar?: WorkspaceConversationSidebarResponse;
  activeConversationId?: string;
  isLoading: boolean;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
};

export function WorkspaceSidebar({
  sidebar,
  activeConversationId,
  isLoading,
  onNewConversation,
  onSelectConversation,
}: WorkspaceSidebarProps) {
  function renderConversationItem(conv: ConversationSidebarItem, depth: number = 0) {
    return (
      <li key={conv.id}>
        <button
          type="button"
          className={`sidebar-conversation-item${conv.id === activeConversationId ? " sidebar-conversation-item--active" : ""}${depth > 0 ? " sidebar-conversation-item--branch" : ""}`}
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
          onClick={() => onSelectConversation(conv.id)}
        >
          {depth > 0 ? "\u21b3 " : ""}{conv.title}
        </button>
        {conv.branches && conv.branches.length > 0 ? (
          <ul className="sidebar-conversation-list sidebar-branch-list">
            {conv.branches.map((branch) => renderConversationItem(branch, depth + 1))}
          </ul>
        ) : undefined}
      </li>
    );
  }

  return (
    <aside className="conversation-sidebar">
      <button
        type="button"
        className="sidebar-new-conversation"
        onClick={onNewConversation}
        disabled={isLoading}
      >
        New conversation
      </button>

      {sidebar?.groups.map((group) => (
        <div key={group.projectId} className="sidebar-project-group">
          <div className="sidebar-project-header">
            <span className="sidebar-project-name">{group.projectName}</span>
            <span className="sidebar-project-count">{group.conversations.length}</span>
          </div>
          {group.featureActivity.length > 0 ? (
            <div className="sidebar-feature-activity">
              {group.featureActivity.map((feature) => (
                <span key={feature.featureId} className="sidebar-feature-chip">
                  {feature.featureName}
                </span>
              ))}
            </div>
          ) : undefined}
          <ul className="sidebar-conversation-list">
            {group.conversations.map((conv) => renderConversationItem(conv))}
          </ul>
        </div>
      ))}

      {sidebar && sidebar.unlinked.length > 0 ? (
        <div className="sidebar-project-group">
          <div className="sidebar-project-header">
            <span className="sidebar-project-name sidebar-unlinked-label">Unlinked</span>
            <span className="sidebar-project-count">{sidebar.unlinked.length}</span>
          </div>
          <ul className="sidebar-conversation-list">
            {sidebar.unlinked.map((conv) => renderConversationItem(conv))}
          </ul>
        </div>
      ) : undefined}
    </aside>
  );
}
