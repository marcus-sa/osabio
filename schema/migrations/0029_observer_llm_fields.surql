BEGIN TRANSACTION;

-- Add LLM verdict confidence score (0.0-1.0)
DEFINE FIELD OVERWRITE confidence ON observation TYPE option<float>;

-- Add evidence references from LLM reasoning — polymorphic record refs matching observes relation targets
DEFINE FIELD OVERWRITE evidence_refs ON observation TYPE option<array<record<project | feature | task | decision | question | observation | intent | git_commit>>>;

COMMIT TRANSACTION;
