-- Add workspace.settings object with observer_skip_deterministic flag.
-- Per-workspace configuration for the observer agent's skip optimization.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE settings ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE settings.observer_skip_deterministic ON workspace TYPE option<bool>;

COMMIT TRANSACTION;
