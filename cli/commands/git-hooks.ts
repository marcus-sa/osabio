/**
 * brain log-commit
 * Deprecated. Commit ingestion is handled by GitHub webhook processing only.
 * Kept as a no-op for backward compatibility with existing post-commit hooks.
 */
export async function runLogCommit(): Promise<void> {
  process.stderr.write(
    "Brain: `log-commit` is disabled. GitHub webhook is the source of truth for commit ingestion.\n",
  );
}
