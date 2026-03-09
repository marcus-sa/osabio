-- Migration 0020: Per-identity authority overrides
-- Adds authorized_to relation table for per-identity permission overrides.
-- Resolution order: per-identity override -> role-based scope -> agent_type scope -> blocked.

DEFINE TABLE OVERWRITE authorized_to TYPE RELATION IN identity OUT authority_scope SCHEMAFULL;
DEFINE FIELD OVERWRITE permission ON authorized_to TYPE string
  ASSERT $value IN ["auto", "provisional", "propose", "blocked"];
DEFINE FIELD OVERWRITE created_at ON authorized_to TYPE datetime;
DEFINE INDEX OVERWRITE authorized_to_lookup ON authorized_to FIELDS in, out UNIQUE;
