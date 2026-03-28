-- Migration: Add total_count and enforcement_mode to evidence_verification object on intent
-- Step-ID: 01-02
-- These fields are written by the evidence verification pipeline but were missing from 0074.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE evidence_verification.total_count ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.enforcement_mode ON intent TYPE string;

COMMIT TRANSACTION;
