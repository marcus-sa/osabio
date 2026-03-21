/**
 * Reciprocal Rank Fusion (RRF) — merges multiple independently-ranked lists
 * into a single fused ranking using rank position rather than raw scores.
 *
 * RRF_score(d) = Σ 1 / (k + rank_i(d))
 *
 * Cormack et al. — k=60 dampens influence of high-rank outliers.
 * Eliminates cross-table BM25 score incomparability by ranking on position.
 *
 * Pure functions — no IO, no side effects.
 */

/** Default RRF constant — dampens influence of high-rank outliers (Cormack et al.) */
const RRF_K = 60;

/**
 * Item in a per-table ranked list. Must carry enough identity to deduplicate
 * across lists (same entity appearing in multiple table queries is unlikely
 * for BM25 cross-table search, but the algorithm handles it correctly).
 */
export type RrfItem<T> = T & { readonly _rrfKey: string };

/**
 * Reciprocal Rank Fusion — merges multiple independently-ranked lists into
 * a single fused ranking using rank position rather than raw scores.
 *
 * RRF_score(d) = Σ 1 / (k + rank_i(d))
 *
 * Each input list must already be sorted by relevance descending (rank 1 = best).
 * Items are identified by `_rrfKey`; if the same key appears in multiple lists,
 * its RRF contributions are summed (true fusion).
 *
 * Pure function — no IO, no side effects.
 */
export function applyRrf<T>(
  rankedLists: ReadonlyArray<ReadonlyArray<RrfItem<T>>>,
  limit: number,
  k: number = RRF_K,
): Array<T & { rrfScore: number }> {
  const scores = new Map<string, { item: T; rrfScore: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const entry = list[rank];
      const contribution = 1 / (k + rank + 1); // rank is 0-based, RRF uses 1-based
      const existing = scores.get(entry._rrfKey);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        // Strip _rrfKey from the stored item
        const { _rrfKey, ...item } = entry;
        scores.set(entry._rrfKey, { item: item as T, rrfScore: contribution });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ item, rrfScore }) => ({ ...item, rrfScore }));
}
