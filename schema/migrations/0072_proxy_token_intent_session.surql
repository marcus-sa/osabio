-- Migration 0072: Add intent and session fields to proxy_token
-- Links proxy tokens to the authorizing intent and agent session.
-- Optional fields: legacy CLI tokens do not have intent/session binding.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE intent ON proxy_token TYPE option<record<intent>>;
DEFINE FIELD OVERWRITE session ON proxy_token TYPE option<record<agent_session>>;

COMMIT TRANSACTION;
