import { useState } from "react";
import { Outlet, createRootRoute, createRoute, createRouter, redirect, useNavigate } from "@tanstack/react-router";
import { authClient } from "./lib/auth-client";
import { WorkspaceGuard } from "./components/layout/WorkspaceGuard";
import { WorkspaceSidebar } from "./components/layout/WorkspaceSidebar";
import { SearchOverlay } from "./components/search/SearchOverlay";
import { useWorkspace } from "./hooks/use-workspace";
import { useWorkspaceState } from "./stores/workspace-state";
import { ChatPage } from "./routes/chat-page";
import { GraphPage } from "./routes/graph-page";
import { HomePage } from "./routes/home-page";
import { ReviewPage } from "./routes/review-page";
import { LearningsPage } from "./routes/learnings-page";
import { PoliciesPage } from "./components/policy/PoliciesPage";
import { PolicyDetailPage } from "./components/policy/PolicyDetailPage";
import { ToolRegistryPage } from "./routes/tool-registry-page";
import { SignInPage } from "./routes/sign-in-page";
import { ConsentPage } from "./routes/consent-page";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Search } from "lucide-react";

function AppShell() {
  const workspace = useWorkspace();
  const sidebar = useWorkspaceState((s) => s.sidebar);
  const sidebarHandlers = useWorkspaceState((s) => s.sidebarHandlers);
  const workspaceName = useWorkspaceState((s) => s.workspaceName);
  const onboardingState = useWorkspaceState((s) => s.onboardingState);
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  function handleNewConversation() {
    if (sidebarHandlers) {
      sidebarHandlers.onNewConversation();
    }
    void navigate({ to: "/chat" });
  }

  function handleSelectConversation(conversationId: string) {
    if (sidebarHandlers) {
      sidebarHandlers.onSelectConversation(conversationId);
    }
    void navigate({ to: "/chat/$conversationId", params: { conversationId } });
  }

  return (
    <WorkspaceGuard
      isReady={workspace.isReady}
      isBootstrapping={workspace.isBootstrapping}
      isCreatingWorkspace={workspace.isCreatingWorkspace}
      canCreateWorkspace={workspace.canCreateWorkspace}
      createWorkspaceName={workspace.createWorkspaceName}
      createWorkspaceDescription={workspace.createWorkspaceDescription}
      createWorkspaceRepoPath={workspace.createWorkspaceRepoPath}
      errorMessage={workspace.errorMessage}
      setCreateWorkspaceName={workspace.setCreateWorkspaceName}
      setCreateWorkspaceDescription={workspace.setCreateWorkspaceDescription}
      setCreateWorkspaceRepoPath={workspace.setCreateWorkspaceRepoPath}
      onCreateWorkspace={workspace.onCreateWorkspace}
    >
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <WorkspaceSidebar
          sidebar={sidebar}
          activeConversationId={sidebarHandlers?.activeConversationId}
          isLoading={sidebarHandlers?.isLoading ?? false}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
            <span className="text-sm font-semibold text-foreground">{workspaceName}</span>
            {onboardingState === "active" ? (
              <Badge variant="secondary">Setting up</Badge>
            ) : onboardingState === "summary_pending" ? (
              <Badge variant="secondary">Review setup</Badge>
            ) : undefined}
            <Button
              variant="outline"
              size="xs"
              className="ml-auto gap-1.5 text-muted-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="size-3" />
              Search...
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </div>
      {searchOpen ? <SearchOverlay onClose={() => setSearchOpen(false)} /> : undefined}
    </WorkspaceGuard>
  );
}

// Root route: bare outlet for public/authenticated split
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Public routes (no auth required)
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/consent",
  component: ConsentPage,
});

// Authenticated layout — checks session before rendering
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  component: AppShell,
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({
        to: "/sign-in",
        search: { redirectTo: location.href },
      });
    }
  },
});

const homeRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/",
  component: HomePage,
});

type ChatSearch = { message?: string };

const validateChatSearch = (search: Record<string, unknown>): ChatSearch => ({
  ...(typeof search.message === "string" ? { message: search.message } : {}),
});

const chatRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/chat",
  component: ChatPage,
  validateSearch: validateChatSearch,
});

const chatConversationRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/chat/$conversationId",
  component: ChatPage,
  validateSearch: validateChatSearch,
});

const graphRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/graph",
  component: GraphPage,
});

const reviewRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/review/$sessionId",
  component: ReviewPage,
});

const learningsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/learnings",
  component: LearningsPage,
});

const policiesRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/policies",
  component: PoliciesPage,
});

const policyDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/policies/$policyId",
  component: PolicyDetailPage,
});

type ToolsSearch = { tab?: string };

const validateToolsSearch = (search: Record<string, unknown>): ToolsSearch => ({
  ...(typeof search.tab === "string" ? { tab: search.tab } : {}),
});

const toolsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/tools",
  component: ToolRegistryPage,
  validateSearch: validateToolsSearch,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  consentRoute,
  authLayout.addChildren([homeRoute, chatRoute, chatConversationRoute, graphRoute, reviewRoute, learningsRoute, policiesRoute, policyDetailRoute, toolsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
