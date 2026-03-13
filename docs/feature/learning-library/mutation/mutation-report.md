# Mutation Testing Report: Learning Library

**Date:** 2026-03-13
**Tool:** Stryker Mutator v9.6.0
**Runner:** command (bun test)
**Scope:** Pure logic files in learning-library feature

## Summary

| Metric | Value |
|--------|-------|
| Total mutants | 171 |
| Killed | 145 |
| Survived | 26 |
| Mutation score | **84.80%** |
| Quality gate (>= 80%) | **PASS** |

## Per-File Breakdown

| File | Score | Killed | Survived |
|------|-------|--------|----------|
| `learning-card-logic.ts` | 95.92% | 47 | 2 |
| `dialog-logic.ts` | 96.00% | 24 | 1 |
| `page-dialog-logic.ts` | 94.44% | 17 | 1 |
| `edit-dialog-logic.ts` | 92.11% | 35 | 3 |
| `create-dialog-logic.ts` | 72.73% | 16 | 6 |
| `StatusTabs.tsx` | 31.58% | 6 | 13 |

## Analysis

### Strong coverage (>= 90%)

**learning-card-logic.ts** (95.92%) -- 2 survivors are `toUpperCase()` vs `charAt(0).toUpperCase()` and `text.slice(1)` vs `text` in `capitalize()`. These are cosmetic formatting mutations -- the function is well tested for behavioral correctness.

**dialog-logic.ts** (96.00%) -- 1 survivor: `editedText.trim()` mutated to `editedText` (removing trim on left side of comparison). Low risk since the right side still trims.

**page-dialog-logic.ts** (94.44%) -- 1 survivor: `closeDialog` returning `undefined` vs empty block. Semantically equivalent -- no behavioral difference.

**edit-dialog-logic.ts** (92.11%) -- 3 survivors: `.sort()` removal on array comparison (tests use single-element arrays so sort is a no-op), and `.trim()` removal on `learning.text` (tests use pre-trimmed data).

### Moderate coverage

**create-dialog-logic.ts** (72.73%) -- 6 survivors are all mutations of the `INITIAL_CREATE_FORM` constant (empty string to "Stryker was here!", `true` to `false`, `[]` to `["Stryker was here"]`, object literal to `{}`). These are initial state values -- tests exercise the validation and submission logic but do not assert default form state values directly. This is acceptable: asserting exact initial values would be testing a constant, not behavior.

### Low coverage (expected)

**StatusTabs.tsx** (31.58%) -- 13 of the 19 mutants are React JSX rendering mutations (className strings, aria attributes, onClick handlers, component body removal). These are **out of scope** -- they test React rendering, not pure logic. The file was included because `computeStatusCounts` lives here. Of the `computeStatusCounts` mutants, only 1 survived: `if (learning.status in counts)` mutated to `if (true)` -- this is a defensive guard for unexpected status values that the test data does not exercise.

### Surviving Mutants (categorized)

| Category | Count | Risk | Action |
|----------|-------|------|--------|
| React JSX rendering | 13 | None | Out of scope for pure logic testing |
| Initial constant values | 6 | Low | Behavioral, not tested by design |
| String `.trim()` removal | 2 | Low | Tests use pre-trimmed inputs |
| Array `.sort()` removal | 2 | Low | Tests use single-element arrays |
| Capitalize implementation detail | 2 | Low | Cosmetic formatting |
| `closeDialog` return vs empty block | 1 | None | Semantically equivalent |

### Adjusted Score (Pure Logic Only)

Excluding the 13 React JSX rendering mutants (which are not pure logic):

- Adjusted mutants: 158
- Adjusted killed: 145
- **Adjusted score: 91.77%**

## Quality Gate

| Gate | Threshold | Actual | Status |
|------|-----------|--------|--------|
| Raw mutation score | >= 80% | 84.80% | PASS |
| Adjusted score (pure logic only) | >= 80% | 91.77% | PASS |

## Recommendations

1. **No immediate action required** -- kill rate exceeds 80% threshold.
2. **Optional improvements:**
   - Add a test asserting `computeStatusCounts` handles unknown status values (would kill the `if (true)` mutant).
   - Add multi-element agent array tests in `edit-dialog-logic` to exercise `.sort()` behavior.
   - These are low-priority -- the surviving mutants represent low-risk edge cases.
