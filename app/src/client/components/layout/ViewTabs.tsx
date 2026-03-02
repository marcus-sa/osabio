import { Link, useMatchRoute } from "@tanstack/react-router";

export function ViewTabs() {
  const matchRoute = useMatchRoute();
  const isHome = matchRoute({ to: "/" });
  const isChat = matchRoute({ to: "/chat" });
  const isGraph = matchRoute({ to: "/graph" });

  return (
    <nav className="view-tabs">
      <Link to="/" className={`view-tab${isHome ? " view-tab--active" : ""}`}>
        Home
      </Link>
      <Link to="/chat" className={`view-tab${isChat ? " view-tab--active" : ""}`}>
        Chat
      </Link>
      <Link to="/graph" className={`view-tab${isGraph ? " view-tab--active" : ""}`}>
        Graph
      </Link>
    </nav>
  );
}
