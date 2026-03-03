import { useState, useEffect, useRef } from "react";
import type { EntityKind } from "../../../shared/contracts";
import { useEntitySearch } from "../../hooks/use-entity-search";
import { SearchFilters } from "./SearchFilters";
import { SearchResultCard } from "./SearchResultCard";

type SearchOverlayProps = {
  onClose: () => void;
};

export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const { results, isSearching, query, setQuery } = useEntitySearch();
  const [activeFilter, setActiveFilter] = useState<EntityKind | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredResults =
    activeFilter === "all"
      ? results
      : results.filter((r) => r.kind === activeFilter);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="search-overlay-backdrop" onClick={onClose}>
      <div className="search-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="search-overlay-header">
          <div className="search-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="Search entities..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="button" className="search-overlay-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <SearchFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        <div className="search-overlay-body">
          {!query.trim() ? (
            <div className="search-empty">
              <p>Type to search across decisions, tasks, features, and more.</p>
            </div>
          ) : isSearching ? (
            <div className="search-empty">
              <p>Searching...</p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="search-empty">
              <p>No results found for &ldquo;{query}&rdquo;.</p>
            </div>
          ) : (
            <div className="search-results">
              {filteredResults.map((result) => (
                <SearchResultCard key={result.id} result={result} onClose={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
