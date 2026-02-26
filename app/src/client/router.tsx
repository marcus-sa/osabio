import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ChatPage } from "./routes/chat-page";

const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <header className="app-header">
        <h1>Brain Phase 1</h1>
        <nav>
          <Link to="/" className="nav-link">
            Chat
          </Link>
        </nav>
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

const routeTree = rootRoute.addChildren([chatRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
