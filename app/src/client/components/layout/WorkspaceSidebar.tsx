import { Link, useMatchRoute } from "@tanstack/react-router";
import type { ConversationSidebarItem, WorkspaceConversationSidebarResponse } from "../../../shared/contracts";
import { usePendingLearningCount } from "../../hooks/use-pending-learning-count";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

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
  const isLearnings = matchRoute({ to: "/learnings" });
  const isPolicies = matchRoute({ to: "/policies" });
  const isTools = matchRoute({ to: "/tools" });
  const isAgents = matchRoute({ to: "/agents" });
  const isSkills = matchRoute({ to: "/skills" });
  const isSettings = matchRoute({ to: "/settings" });
  const { pendingCount } = usePendingLearningCount();

  function renderConversationItem(conv: ConversationSidebarItem, depth: number = 0) {
    return (
      <li key={conv.id}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 truncate rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-hover",
            conv.id === activeConversationId && "bg-active text-accent",
            depth > 0 && "text-muted-foreground",
          )}
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
          onClick={() => onSelectConversation(conv.id)}
        >
          {depth > 0 ? "\u21b3 " : ""}{conv.title}
        </button>
        {conv.branches && conv.branches.length > 0 ? (
          <ul className="flex flex-col">
            {conv.branches.map((branch) => renderConversationItem(branch, depth + 1))}
          </ul>
        ) : undefined}
      </li>
    );
  }

  const navItemClass = (active: boolean | object | undefined) =>
    cn(
      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-hover",
      active && "bg-active text-accent",
    );

  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-sidebar p-2">
      {/* Navigation links */}
      <Link to="/" className={navItemClass(isHome)}>Feed</Link>
      <Link to="/graph" className={navItemClass(isGraph)}>Graph</Link>
      <Link to="/learnings" className={navItemClass(isLearnings)}>
        Learnings
        {pendingCount > 0 ? (
          <Badge variant="secondary" className="ml-auto h-4 min-w-4 px-1 text-[0.6rem]">{pendingCount}</Badge>
        ) : undefined}
      </Link>
      <Link to="/policies" className={navItemClass(isPolicies)}>Policies</Link>
      <Link to="/tools" className={navItemClass(isTools)}>Tools</Link>
      <Link to="/agents" className={navItemClass(isAgents)}>Agents</Link>
      <Link to="/skills" className={navItemClass(isSkills)}>Skills</Link>
      <Link to="/settings" className={navItemClass(isSettings)}>Settings</Link>

      <Separator className="my-1" />

      {/* Projects section */}
      <div className="flex flex-col gap-0.5">
        <span className="px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Projects</span>
        {sidebar?.groups.map((group) => (
          <Link
            key={group.projectId}
            to="/"
            className={cn(
              "truncate rounded-md px-2 py-1 text-xs text-entity-project-fg transition-colors hover:bg-hover",
            )}
          >
            #{group.projectName}
          </Link>
        ))}
      </div>

      {/* Agents section */}
      <div className="flex flex-col gap-0.5">
        <span className="px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Agents</span>
        <span className="px-2 py-1 text-xs text-entity-task-fg">@pm</span>
      </div>

      <Separator className="my-1" />

      {/* Chats section */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        <div className="flex items-center justify-between px-2">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Chats</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onNewConversation}
            disabled={isLoading}
            title="New conversation"
          >
            +
          </Button>
        </div>
        {sidebar?.groups.map((group) =>
          group.conversations.length > 0 ? (
            <ul key={group.projectId} className="flex flex-col">
              {group.conversations.map((conv) => renderConversationItem(conv))}
            </ul>
          ) : undefined,
        )}
        {sidebar && sidebar.unlinked.length > 0 ? (
          <ul className="flex flex-col">
            {sidebar.unlinked.map((conv) => renderConversationItem(conv))}
          </ul>
        ) : undefined}
      </div>
    </aside>
  );
}
