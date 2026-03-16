import { GovernanceFeed } from "../components/feed/GovernanceFeed";
import { useGovernanceFeed } from "../hooks/use-governance-feed";

export function HomePage() {
  const { feed, isLoading, error, refresh } = useGovernanceFeed();

  return (
    <section className="mx-auto max-w-4xl p-6">
      <GovernanceFeed
        feed={feed}
        isLoading={isLoading}
        error={error}
        onRefresh={refresh}
      />
    </section>
  );
}
