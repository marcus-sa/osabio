-- Migration: R2 fabrication resistance schema fields
-- Step-ID: 03-01
--
-- Adds to intent.evidence_verification:
--   independent_author_count (int) -- number of distinct authors across evidence refs
--   tier_met (bool) -- whether evidence meets the risk-tier requirement
--
-- Adds to workspace:
--   evidence_enforcement_threshold (object) -- maturity threshold for auto-transition
--   evidence_enforcement_threshold.min_decisions (int)
--   evidence_enforcement_threshold.min_tasks (int)
--   min_evidence_age_minutes (int) -- minimum age in minutes for evidence refs

BEGIN TRANSACTION;

-- Intent: fabrication resistance fields on evidence_verification
DEFINE FIELD OVERWRITE evidence_verification.independent_author_count ON intent TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_verification.tier_met ON intent TYPE option<bool>;

-- Workspace: enforcement maturity threshold
DEFINE FIELD OVERWRITE evidence_enforcement_threshold ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_decisions ON workspace TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_tasks ON workspace TYPE option<int>;

-- Workspace: minimum evidence age in minutes
DEFINE FIELD OVERWRITE min_evidence_age_minutes ON workspace TYPE option<int>;

COMMIT TRANSACTION;
