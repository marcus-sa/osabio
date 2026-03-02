import { GovernanceFeed } from "../components/feed/GovernanceFeed";
import { useGovernanceFeed } from "../hooks/use-governance-feed";

export function HomePage() {
  const { feed, isLoading, error, refresh } = useGovernanceFeed();

  return (
    <section className="home-page">
      <div className="home-page-header">
        <h2>Governance Feed</h2>
        <button
          type="button"
          className="feed-refresh-btn"
          onClick={refresh}
          disabled={isLoading}
        >
          Refresh
        </button>
      </div>
      <GovernanceFeed
        feed={feed}
        isLoading={isLoading}
        error={error}
        onRefresh={refresh}
      />
    </section>
  );
}
