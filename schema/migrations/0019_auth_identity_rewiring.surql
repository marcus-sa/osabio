-- Migration 0019: Auth identity rewiring (no-op)
-- better-auth continues to use person as user model.
-- Identity is resolved from person via identity_person spoke edge at runtime.
-- Session.person_id and account.person_id remain unchanged.
-- OAuth tables userId remain record<person>.
-- No schema changes required - the spoke traversal pattern is purely application-layer.

-- Intentionally empty: auth rewiring is implemented via spoke traversal in application code,
-- not via schema changes to session/account/OAuth tables.
