-- Extend implemented_by relation to allow tasks as source,
-- so commits can be linked to the tasks they progressed.

DEFINE TABLE OVERWRITE implemented_by TYPE RELATION IN decision | task OUT git_commit | pull_request SCHEMAFULL;
DEFINE FIELD commit_sha ON implemented_by TYPE option<string>;
DEFINE FIELD pr_url ON implemented_by TYPE option<string>;
DEFINE FIELD linked_at ON implemented_by TYPE option<datetime>;
