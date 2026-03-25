-- Add outcome field to trace table for tool call tracing
-- Used by agent MCP governance to record success/error/intent_required outcomes
BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE outcome ON trace TYPE option<string>;
DEFINE FIELD OVERWRITE intent ON trace TYPE option<record<intent>>;

COMMIT TRANSACTION;
