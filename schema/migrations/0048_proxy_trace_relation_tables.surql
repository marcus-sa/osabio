-- Migration 0048: Define relation tables for proxy trace edges
--
-- The proxy trace writer creates invoked, scoped_to, and attributed_to
-- edges but the relation tables were never defined. In SCHEMAFULL mode,
-- RELATE silently fails for undefined tables.

DEFINE TABLE OVERWRITE invoked TYPE RELATION IN agent_session OUT trace SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON invoked TYPE datetime;

DEFINE TABLE OVERWRITE scoped_to TYPE RELATION IN trace OUT workspace SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON scoped_to TYPE datetime;

DEFINE TABLE OVERWRITE attributed_to TYPE RELATION IN trace OUT task SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON attributed_to TYPE datetime;
