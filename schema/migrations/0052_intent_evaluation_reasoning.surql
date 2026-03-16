-- Add evaluation.reasoning field to intent table for LLM chain-of-thought
-- stored inside the evaluation object (distinct from top-level llm_reasoning).
-- The evaluationResultSchema returns both reason (one-line) and reasoning (full CoT).
-- SCHEMAFULL rejects unknown nested fields, so this must be declared.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE evaluation.reasoning ON intent TYPE option<string>;

COMMIT TRANSACTION;
