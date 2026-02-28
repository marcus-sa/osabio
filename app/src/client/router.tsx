import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ChatPage } from "./routes/chat-page";
import { GraphPage } from "./routes/graph-page";
import { ViewTabs } from "./components/layout/ViewTabs";

const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <header className="app-header">
        <h1>Brain</h1>
        <ViewTabs />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  ),
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChatPage,
});

const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  component: GraphPage,
});

const routeTree = rootRoute.addChildren([chatRoute, graphRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
