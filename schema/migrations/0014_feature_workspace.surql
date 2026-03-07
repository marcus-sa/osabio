-- Add workspace field to feature table (mirrors task.workspace pattern).
-- Features were previously only discoverable via has_feature edges from projects,
-- making orphan features (missing edge) invisible to search and listing tools.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE workspace ON feature TYPE record<workspace>;
DEFINE INDEX OVERWRITE feature_workspace ON feature FIELDS workspace;

COMMIT TRANSACTION;
