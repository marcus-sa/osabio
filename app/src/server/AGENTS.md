## Fire-and-Forget & Inflight Tracking

- Do NOT use `void` for fire-and-forget DB operations in route handlers. Background work that uses the SurrealDB connection will fail with `ConnectionUnavailableError` when smoke tests close the DB in `afterAll`.
- Route-level async work (e.g. `processGitCommits`, `processChatMessage`) must be tracked via `deps.inflight.track(promise)`. The `InflightTracker` (`runtime/types.ts`) lets smoke tests `drain()` pending work before closing connections.
- Nested async work inside tracked parents (e.g. `seedDescriptionEntry`, `fireDescriptionUpdates`, `persistEmbeddings`) should use `await ... .catch(() => undefined)` instead of `void`. Since the parent is already background work, awaiting doesn't affect user-facing latency.
- When adding new background DB operations in route handlers, always use `deps.inflight.track()` or `await` within an already-tracked parent.
