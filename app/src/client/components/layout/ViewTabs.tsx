import { Link, useMatchRoute } from "@tanstack/react-router";

export function ViewTabs() {
  const matchRoute = useMatchRoute();
  const isChat = matchRoute({ to: "/" });
  const isGraph = matchRoute({ to: "/graph" });

  return (
    <nav className="view-tabs">
      <Link to="/" className={`view-tab${isChat ? " view-tab--active" : ""}`}>
        Chat
      </Link>
      <Link to="/graph" className={`view-tab${isGraph ? " view-tab--active" : ""}`}>
        Graph
      </Link>
    </nav>
  );
}
