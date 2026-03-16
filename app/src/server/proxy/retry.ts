/**
 * Retry with Exponential Backoff
 *
 * Shared retry utility for SurrealDB operations that may encounter
 * transaction conflicts under concurrent load.
 */

import { logWarn } from "../http/observability";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

export async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        logWarn("proxy.retry", `Retry ${attempt + 1}/${MAX_RETRIES} for ${label}`, {
          attempt: attempt + 1,
          delay_ms: delayMs,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
