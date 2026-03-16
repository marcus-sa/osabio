-- Step 02-01: Remove top-level llm_reasoning field from intent table
-- LLM chain-of-thought reasoning is stored inside evaluation.reasoning instead.
-- See migration 0052 for the evaluation.reasoning field definition.

BEGIN TRANSACTION;

REMOVE FIELD IF EXISTS llm_reasoning ON intent;

COMMIT TRANSACTION;
