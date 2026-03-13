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
import { SignInPage } from "./routes/sign-in-page";
import { ConsentPage } from "./routes/consent-page";

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
      <div className="app-shell">
        <WorkspaceSidebar
          sidebar={sidebar}
          activeConversationId={sidebarHandlers?.activeConversationId}
          isLoading={sidebarHandlers?.isLoading ?? false}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
        />
        <div className="app-main">
          <div className="content-header">
            <span className="content-header-title">{workspaceName}</span>
            {onboardingState === "active" ? (
              <span className="onboarding-badge">Setting up</span>
            ) : onboardingState === "summary_pending" ? (
              <span className="onboarding-badge">Review setup</span>
            ) : undefined}
            <button
              type="button"
              className="search-trigger"
              onClick={() => setSearchOpen(true)}
            >
              Search...
            </button>
          </div>
          <div className="app-content">
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

const routeTree = rootRoute.addChildren([
  signInRoute,
  consentRoute,
  authLayout.addChildren([homeRoute, chatRoute, chatConversationRoute, graphRoute, reviewRoute, learningsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
