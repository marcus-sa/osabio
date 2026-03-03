import { Link, useMatchRoute } from "@tanstack/react-router";
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
  const matchRoute = useMatchRoute();
  const isHome = matchRoute({ to: "/" });
  const isGraph = matchRoute({ to: "/graph" });

  function renderConversationItem(conv: ConversationSidebarItem, depth: number = 0) {
    return (
      <li key={conv.id}>
        <button
          type="button"
          className={`sidebar-item sidebar-conversation-item${conv.id === activeConversationId ? " sidebar-item--active" : ""}${depth > 0 ? " sidebar-conversation-item--branch" : ""}`}
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
          onClick={() => onSelectConversation(conv.id)}
        >
          {depth > 0 ? "\u21b3 " : ""}{conv.title}
        </button>
        {conv.branches && conv.branches.length > 0 ? (
          <ul className="sidebar-list sidebar-branch-list">
            {conv.branches.map((branch) => renderConversationItem(branch, depth + 1))}
          </ul>
        ) : undefined}
      </li>
    );
  }

  return (
    <aside className="workspace-sidebar">
      {/* Projects section */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Projects</div>
        {sidebar?.groups.map((group) => (
          <Link
            key={group.projectId}
            to="/"
            className={`sidebar-item sidebar-project-item${isHome ? " sidebar-item--active" : ""}`}
          >
            #{group.projectName}
          </Link>
        ))}
      </div>

      {/* Agents section */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Agents</div>
        <span className="sidebar-item sidebar-agent-item">@pm</span>
      </div>

      <div className="sidebar-divider" />

      {/* Chats section */}
      <div className="sidebar-section sidebar-section--chats">
        <div className="sidebar-section-label">
          Chats
          <button
            type="button"
            className="sidebar-new-chat-btn"
            onClick={onNewConversation}
            disabled={isLoading}
            title="New conversation"
          >
            +
          </button>
        </div>
        {sidebar?.groups.map((group) =>
          group.conversations.length > 0 ? (
            <ul key={group.projectId} className="sidebar-list">
              {group.conversations.map((conv) => renderConversationItem(conv))}
            </ul>
          ) : undefined,
        )}
        {sidebar && sidebar.unlinked.length > 0 ? (
          <ul className="sidebar-list">
            {sidebar.unlinked.map((conv) => renderConversationItem(conv))}
          </ul>
        ) : undefined}
      </div>

      <div className="sidebar-divider" />

      {/* Graph link */}
      <Link to="/graph" className={`sidebar-item sidebar-nav-item${isGraph ? " sidebar-item--active" : ""}`}>
        Graph
      </Link>
    </aside>
  );
}
