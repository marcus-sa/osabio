-- Skill table and relation tables for the Skills feature
-- See docs/feature/skills/design/architecture.md Section 6.1
BEGIN TRANSACTION;

-- skill table
DEFINE TABLE OVERWRITE skill SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON skill TYPE string;
DEFINE FIELD OVERWRITE description ON skill TYPE string;
DEFINE FIELD OVERWRITE version ON skill TYPE string;
DEFINE FIELD OVERWRITE status ON skill TYPE string ASSERT $value IN ["draft", "active", "deprecated"];
DEFINE FIELD OVERWRITE workspace ON skill TYPE record<workspace>;
DEFINE FIELD OVERWRITE source ON skill TYPE object;
DEFINE FIELD OVERWRITE source.type ON skill TYPE string ASSERT $value IN ["github", "git"];
DEFINE FIELD OVERWRITE source.source ON skill TYPE string;
DEFINE FIELD OVERWRITE source.ref ON skill TYPE option<string>;
DEFINE FIELD OVERWRITE source.subpath ON skill TYPE option<string>;
DEFINE FIELD OVERWRITE source.skills ON skill TYPE option<array<string>>;
DEFINE FIELD OVERWRITE created_by ON skill TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE created_at ON skill TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON skill TYPE option<datetime>;

-- Non-UNIQUE index due to SurrealDB v3.0.4 UNIQUE index bug (see docs/agents/surrealdb.md)
DEFINE INDEX OVERWRITE idx_skill_workspace_name ON skill FIELDS workspace, name;

-- Relation: skill requires mcp_tool
DEFINE TABLE OVERWRITE skill_requires TYPE RELATION IN skill OUT mcp_tool SCHEMAFULL;

-- Relation: identity possesses skill
DEFINE TABLE OVERWRITE possesses TYPE RELATION IN identity OUT skill SCHEMAFULL;
DEFINE FIELD OVERWRITE granted_at ON possesses TYPE datetime DEFAULT time::now();

-- Relation: skill supersedes skill
DEFINE TABLE OVERWRITE skill_supersedes TYPE RELATION IN skill OUT skill SCHEMAFULL;

-- Relation: skill evidence links to agent_session, trace, or observation
DEFINE TABLE OVERWRITE skill_evidence TYPE RELATION IN skill OUT agent_session | trace | observation SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON skill_evidence TYPE datetime;

-- Relation: policy governs skill
DEFINE TABLE OVERWRITE governs_skill TYPE RELATION IN policy OUT skill SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON governs_skill TYPE datetime;

COMMIT TRANSACTION;
