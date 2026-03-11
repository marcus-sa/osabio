# Root Cause Analysis: Embedding API Failures Crashing Work Item Creation

**Date:** 2026-03-11
**Analyst:** Rex (RCA Specialist)
**Affected Tests:** `tests/acceptance/graph/create-work-item-edge.test.ts` (3 tests)
**Branch:** `marcus-sa/graph-view-policies`

---

## Problem Statement

Three acceptance tests in `create-work-item-edge.test.ts` fail because OpenRouter's embedding API (`openai/text-embedding-3-small`) returns a 404-in-200 error response:

```
HTTP 200 with body: {"error":{"message":"No successful provider responses.","code":404}}
```

The Vercel AI SDK interprets this as `AI_APICallError: Invalid JSON response` because the response body does not match the expected embedding schema. This error propagates uncaught through `createEmbeddingVector` and crashes the `create_work_item` tool's `execute` function, failing all three tests.

---

## Scope

- **Affected system:** `create_work_item` chat tool (used by PM agent and chat agent)
- **Affected code path:** `createEmbeddingVector()` in `app/src/server/graph/embeddings.ts`, called from `app/src/server/chat/tools/create-work-item.ts` line 37
- **Not affected:** `persistEmbeddings()` in `extraction/embedding-writeback.ts` (has try/catch), `chat-route.ts` (fire-and-forget via `inflight.track`)
- **Time range:** Whenever OpenRouter's embedding provider is unavailable or returns error-in-200

---

## Evidence Inventory

| # | Evidence | Source |
|---|----------|--------|
| E1 | Error response: HTTP 200 with `{"error":{"message":"No successful provider responses.","code":404}}` | Test failure output |
| E2 | `createEmbeddingVector()` has no try/catch -- raw `await embed()` call at line 13 | `app/src/server/graph/embeddings.ts:13` |
| E3 | `create-work-item.ts` calls `createEmbeddingVector()` at line 37 with no try/catch | `app/src/server/chat/tools/create-work-item.ts:37` |
| E4 | `persistEmbeddings()` wraps its embed calls in try/catch and logs errors | `app/src/server/extraction/embedding-writeback.ts:20-60` |
| E5 | `chat-route.ts` calls `persistEmbeddings` as fire-and-forget: `deps.inflight.track(persistEmbeddings(...).catch(...))` | `app/src/server/chat/chat-route.ts:275-276` |
| E6 | `work-item-accept-route.ts` calls `createEmbeddingVector` inside a try/catch block | `app/src/server/entities/work-item-accept-route.ts:62-64` |
| E7 | Embedding result is used optionally: `...(embedding ? { embedding } : {})` -- entity creation works without it | `create-work-item.ts:103, 157` and `work-item-accept-route.ts` |
| E8 | `suggestion/queries.ts` also calls `createEmbeddingVector` without try/catch (same vulnerability) | `app/src/server/suggestion/queries.ts:224` |

---

## Toyota 5 Whys Analysis

### Branch A: Unhandled Embedding API Error

```
WHY 1A: Tests crash with AI_APICallError when creating work items
  [Evidence: E1 -- OpenRouter returns error-in-200, SDK throws AI_APICallError]

  WHY 2A: The error from embed() propagates uncaught to the tool's execute()
    [Evidence: E2, E3 -- createEmbeddingVector has no try/catch; create-work-item.ts
     calls it at line 37 before any DB writes, with no error handling]

    WHY 3A: createEmbeddingVector() was designed as a thin wrapper assuming embed() always succeeds
      [Evidence: E2 -- function only handles empty input and dimension mismatch,
       not API/network errors. Returns Promise<number[] | undefined> but the
       undefined path is only for empty input or wrong dimensions, not API failure]

      WHY 4A: No resilience contract was defined for embedding generation in tool contexts
        [Evidence: E4, E5 vs E3 -- the extraction pipeline (embedding-writeback.ts)
         HAS try/catch and the chat route uses fire-and-forget, showing the team
         understood embeddings can fail. But the tool path was added later without
         the same resilience pattern]

        WHY 5A: Missing error-handling consistency policy across embedding call sites
          [Evidence: E6 vs E3 -- work-item-accept-route.ts wraps the same call in
           try/catch while create-work-item.ts does not. Same operation, different
           resilience. No shared pattern enforced.]

-> ROOT CAUSE A: createEmbeddingVector() lacks internal error handling, and
   create-work-item.ts (and suggestion/queries.ts) call it without try/catch,
   unlike other call sites that do handle failures.
```

### Branch B: Embedding Is Blocking When It Should Be Optional

```
WHY 1B: Work item creation fails entirely when embedding fails
  [Evidence: E3 -- embed call at line 37 runs BEFORE any entity creation (lines 57-106)]

  WHY 2B: The embedding call is positioned as a blocking prerequisite to entity creation
    [Evidence: E3 -- line 37 runs first, then entityId assignment at line 43,
     then DB writes. If line 37 throws, nothing is created.]

    WHY 3B: The code already handles the "no embedding" case gracefully
      [Evidence: E7 -- all three entity paths use conditional spreading:
       `...(embedding ? { embedding } : {})`. Entity creation works fine with
       undefined embedding. The embedding is enrichment, not required.]

      WHY 4B: The function signature returns `Promise<number[] | undefined>` suggesting
              it was designed for graceful degradation, but only for non-error cases
        [Evidence: E2 -- returns undefined for empty input and dimension mismatch,
         but throws for API errors. The caller pattern (conditional spread) was
         designed around the undefined return, not around thrown errors.]

        WHY 5B: The error contract between createEmbeddingVector and its callers is
                incomplete -- it handles known non-error scenarios but not API failures
          [Evidence: E2, E7 -- the function returns undefined for "no embedding
           available" cases but throws for "embedding service failed" cases.
           Both should result in the same outcome: proceed without embedding.]

-> ROOT CAUSE B: createEmbeddingVector's error contract is incomplete. It returns
   undefined for anticipated non-error cases but throws for API failures, even
   though the callers already handle the undefined (no-embedding) case correctly.
```

### Branch C: OpenRouter Error-in-200 Pattern

```
WHY 1C: OpenRouter returns HTTP 200 with an error body instead of a proper HTTP error code
  [Evidence: E1 -- HTTP 200 with {"error":{"message":"No successful provider responses.","code":404}}]

  WHY 2C: This is a known OpenRouter pattern where provider routing failures are returned
          as 200 with an error payload rather than as HTTP 502/503
    [Evidence: E1 -- the error message "No successful provider responses" indicates
     OpenRouter tried multiple upstream providers and all failed, but wrapped the
     failure in a 200 response]

    WHY 3C: The Vercel AI SDK parses the 200 response body expecting an embedding result,
            finds an error object instead, and throws AI_APICallError
      [Evidence: E1 -- "Invalid JSON response" error because the SDK expected
       {data: [{embedding: [...]}]} but got {error: {...}}]

-> ROOT CAUSE C: External dependency (OpenRouter) exhibits a non-standard error
   pattern (error-in-200) that the SDK translates into a thrown error. This is an
   external factor that cannot be prevented, only handled resiliently.
```

---

## Cross-Validation

| Root Cause | Forward Trace | Explains Symptoms? |
|------------|---------------|-------------------|
| A: No try/catch in createEmbeddingVector or create-work-item.ts | API error -> thrown -> uncaught -> tool crashes -> test fails | Yes |
| B: Embedding is blocking but optional | Error at line 37 prevents entity creation at lines 57+ despite entities not requiring embedding | Yes |
| C: OpenRouter error-in-200 | External trigger that initiates the failure chain | Yes (trigger) |

All three root causes are consistent and non-contradictory. A + B are code-level causes, C is the external trigger. Fixing A and B makes the system resilient to C.

---

## Determination: Should Embedding Be Resilient (Non-Blocking) or Correctly Block?

**Embedding should be resilient (non-blocking).** Evidence:

1. **Entity creation does not require embeddings** -- all three entity paths (project, task, feature) use conditional spreading `...(embedding ? { embedding } : {})` (E7). Entities are fully functional without embeddings.

2. **Embeddings are enrichment for search** -- they enable vector similarity search but are not part of the entity's domain contract. A task without an embedding is still a valid task.

3. **Other code paths treat embeddings as optional** -- `chat-route.ts` uses fire-and-forget (E5), `work-item-accept-route.ts` wraps in try/catch (E6). The `create_work_item` tool is the outlier.

4. **The function's return type already signals optionality** -- `Promise<number[] | undefined>` (E2). Callers are designed around the possibility of no embedding.

---

## Solution Recommendations

### Immediate Mitigation (P0 -- unblocks tests, prevents production crashes)

**Add try/catch around `createEmbeddingVector` in `create-work-item.ts`:**

Wrap the embedding call at line 37 in a try/catch that logs the error and sets `embedding` to `undefined`. The rest of the function already handles `undefined` embedding correctly.

```typescript
// Line 37-41 of create-work-item.ts -- current:
const embedding = await createEmbeddingVector(
  deps.embeddingModel,
  input.title,
  deps.embeddingDimension,
);

// Proposed:
let embedding: number[] | undefined;
try {
  embedding = await createEmbeddingVector(
    deps.embeddingModel,
    input.title,
    deps.embeddingDimension,
  );
} catch (err) {
  logError("create_work_item", "embedding generation failed, proceeding without embedding", err);
}
```

**Apply same fix to `suggestion/queries.ts` line 224** (same vulnerability, E8).

### Permanent Fix (P1 -- prevent recurrence across all call sites)

**Option 1: Harden `createEmbeddingVector` itself** to catch API errors internally and return `undefined`:

```typescript
// In app/src/server/graph/embeddings.ts
export async function createEmbeddingVector(
  embeddingModel: Parameters<typeof embed>[0]["model"],
  value: string,
  expectedDimension: number,
): Promise<number[] | undefined> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  try {
    const result = await embed({ model: embeddingModel, value: normalized });
    if (result.embedding.length !== expectedDimension) {
      return undefined;
    }
    return result.embedding;
  } catch (err) {
    logError("embedding.create.failed", "Embedding API call failed", err);
    return undefined;
  }
}
```

This is the preferred approach because:
- The function's return type `Promise<number[] | undefined>` already communicates that callers should handle the no-embedding case
- Centralizes error handling -- all callers automatically become resilient
- Matches the function's existing semantic contract (returns undefined when embedding is unavailable)
- `persistEmbeddings` in `embedding-writeback.ts` already has its own try/catch, so double-catching is harmless (the inner catch just means the outer catch never fires for API errors)

**Option 2: Leave `createEmbeddingVector` as-is and enforce try/catch at every call site.** Less preferred -- requires discipline at every call site and is prone to the same omission that caused this bug.

### Early Detection (P2 -- catch faster next time)

1. Add an acceptance test that explicitly mocks/stubs the embedding model to throw, verifying that `create_work_item` still creates the entity successfully without an embedding.
2. Consider a linter rule or code review checklist item: "all `createEmbeddingVector` calls must be wrapped in try/catch or the function itself must be hardened."

---

## Affected Files Summary

| File | Issue | Fix Needed |
|------|-------|------------|
| `app/src/server/graph/embeddings.ts` | `createEmbeddingVector` has no try/catch around `embed()` | Add internal error handling (permanent fix) |
| `app/src/server/chat/tools/create-work-item.ts:37` | Calls `createEmbeddingVector` without try/catch | Add try/catch (immediate mitigation) |
| `app/src/server/suggestion/queries.ts:224` | Same vulnerability as create-work-item | Add try/catch (immediate mitigation) |
| `app/src/server/extraction/embedding-writeback.ts` | Already has try/catch -- NOT affected | None |
| `app/src/server/entities/work-item-accept-route.ts` | Already has try/catch -- NOT affected | None |
| `app/src/server/chat/chat-route.ts` | Uses fire-and-forget with `.catch()` -- NOT affected | None |
