-- Step 02-01: Add llm_reasoning field to intent table
-- Stores the full LLM chain-of-thought reasoning from the authorizer evaluation.
-- Distinct from `reasoning` (human-authored) and `evaluation.reason` (one-line summary).
-- Policy-only evaluations must not set this field.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE llm_reasoning ON intent TYPE option<string>;

COMMIT TRANSACTION;
