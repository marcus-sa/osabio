import { useState, useEffect, useRef } from "react";
import type { EntityKind } from "../../../shared/contracts";
import { useEntitySearch } from "../../hooks/use-entity-search";
import { SearchFilters } from "./SearchFilters";
import { SearchResultCard } from "./SearchResultCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { X } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh] backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search entities..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        <SearchFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <p>Type to search across decisions, tasks, features, and more.</p>
            </div>
          ) : isSearching ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <p>Searching...</p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <p>No results found for &ldquo;{query}&rdquo;.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
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
