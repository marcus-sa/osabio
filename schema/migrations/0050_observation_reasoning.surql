-- Add optional reasoning field to observation table.
-- Stores LLM chain-of-thought reasoning when observations are created
-- via the verification pipeline. Deterministic observations omit this field.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE reasoning ON observation TYPE option<string>;

COMMIT TRANSACTION;
