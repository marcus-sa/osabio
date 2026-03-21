Feature: Remove Embeddings from Brain Knowledge Graph
  As a Brain platform engineer
  I want to replace vector embedding infrastructure with BM25 fulltext search and graph traversal
  So that the system is faster, more reliable, and simpler to maintain

  # ========================================================================
  # Phase 1: Chat Agent Search (search_entities tool)
  # ========================================================================

  Scenario: Chat agent finds entities by keyword via BM25 search
    Given the workspace "Acme Corp" has a project "Platform Migration"
    And the project has a decision "Standardize all APIs on tRPC"
    And the project has a task "Migrate billing API to tRPC"
    When the chat agent searches for "tRPC migration"
    Then the search returns the decision "Standardize all APIs on tRPC"
    And the search returns the task "Migrate billing API to tRPC"
    And no embedding API call was made

  Scenario: Chat agent search handles stemmed variations
    Given the workspace "Acme Corp" has a task "Implementing rate limiting for public endpoints"
    When the chat agent searches for "rate limit implementation"
    Then the search returns the task "Implementing rate limiting for public endpoints"
    And the BM25 stemmer matched "implementing" to "implementation" and "limiting" to "limit"

  Scenario: Chat agent search filters by entity kind
    Given the workspace "Acme Corp" has a decision "Use PostgreSQL for analytics"
    And the workspace has a task "Set up PostgreSQL cluster"
    When the chat agent searches for "PostgreSQL" with kinds ["decision"]
    Then the search returns only the decision "Use PostgreSQL for analytics"
    And the task is excluded from results

  Scenario: Chat agent search filters by project scope
    Given the workspace "Acme Corp" has project "Alpha" with task "Deploy auth service"
    And the workspace has project "Beta" with task "Deploy auth proxy"
    When the chat agent searches for "deploy auth" in project "Alpha"
    Then the search returns only the task "Deploy auth service"

  Scenario: Chat agent search returns empty results gracefully
    Given the workspace "Acme Corp" has no entities matching "quantum computing"
    When the chat agent searches for "quantum computing"
    Then the search returns an empty result set
    And no error is raised

  # ========================================================================
  # Phase 1: Learning Collision Detection
  # ========================================================================

  Scenario: Dismissed learning blocks re-suggestion via BM25
    Given the workspace "Acme Corp" has a dismissed learning "Always run integration tests before merging PRs"
    When the Observer proposes a learning "Always run integration tests before merging pull requests"
    Then the proposal is blocked with reason "dismissed_similarity"
    And the matched text is "Always run integration tests before merging PRs"
    And no embedding API call was made

  Scenario: Active learning coverage prevents duplicate proposals
    Given the workspace "Acme Corp" has an active learning "Enforce code review approval before merge"
    When the Observer proposes a learning "Require code review sign-off before merging"
    Then the proposal is blocked because an active learning already covers this pattern
    And no embedding API call was made

  Scenario: Genuinely new learning passes collision detection
    Given the workspace "Acme Corp" has an active learning "Enforce code review approval before merge"
    And the workspace has a dismissed learning "Always run integration tests before merging PRs"
    When the Observer proposes a learning "Add circuit breaker to payment service external calls"
    Then the proposal passes collision detection
    And the learning is created with status "pending_approval"

  Scenario: Observation cluster coverage check uses BM25
    Given the workspace "Acme Corp" has 5 open observations about "database connection timeout"
    And the workspace has an active learning "Monitor database connection pool exhaustion"
    When the diagnostic clustering pipeline runs
    Then the cluster is identified as covered by the active learning
    And the cluster is skipped without LLM classification

  # ========================================================================
  # Phase 1: Objective-Intent Alignment
  # ========================================================================

  Scenario: Intent aligns with objective via graph traversal
    Given the workspace "Acme Corp" has an active objective "Improve platform reliability"
    And the objective is linked to project "Infrastructure"
    And the project has a task "Implement rate limiting"
    When the Authorizer evaluates an intent referencing task "Implement rate limiting"
    Then the alignment classification is "matched"
    And a supports edge is created between the intent and the objective
    And no embedding API call was made

  Scenario: Intent alignment via project-level graph path
    Given the workspace "Acme Corp" has an active objective "Launch MVP by Q3"
    And the objective is linked to project "Product Launch"
    And the intent resolves to project "Product Launch"
    When the Authorizer evaluates the intent
    Then the alignment classification is "matched"
    And the alignment evidence is the graph path "intent -> project -> objective"

  Scenario: Unaligned intent creates warning observation
    Given the workspace "Acme Corp" has an active objective "Improve platform reliability"
    And the objective is linked to project "Infrastructure"
    And the intent resolves to project "Marketing Site"
    And no graph path connects "Marketing Site" to any active objective
    When the Authorizer evaluates the intent
    Then the alignment classification is "none"
    And a warning observation is created about unaligned work

  Scenario: Free-form intent falls back to BM25 alignment
    Given the workspace "Acme Corp" has an active objective "Reduce deployment failures by 50%"
    And the intent description is "fix the flaky CI pipeline that blocks deploys"
    And the intent does not resolve to any specific task or project
    When the Authorizer evaluates the intent
    Then BM25 search matches "deployment" and "deploys" via stemming
    And the alignment classification is "ambiguous"

  # ========================================================================
  # Phase 2: Proxy Context Injection
  # ========================================================================

  Scenario: Context injection ranks by recency and project relevance
    Given the workspace "Acme Corp" has project "Auth Service"
    And the project has a recent decision "Use OAuth 2.1 for all external APIs" (updated 2 hours ago)
    And the project has an older decision "Use session cookies for internal services" (updated 30 days ago)
    When a proxy message about "implementing OAuth flow" is processed for project "Auth Service"
    Then the recent decision is ranked higher than the older decision
    And both decisions are injected into the system prompt
    And no embedding API call was made

  Scenario: Recent changes classified by time proximity
    Given a decision "Switch to tRPC" was updated 10 minutes ago in project "Platform"
    And a task "Migrate billing API" was updated 2 hours ago in project "Platform"
    When the proxy processes a message in the context of project "Platform"
    Then "Switch to tRPC" is classified as urgent-context (updated within 30 minutes)
    And "Migrate billing API" is classified as context-update (updated within 24 hours)

  # ========================================================================
  # Phase 3: Infrastructure Removal
  # ========================================================================

  Scenario: All HNSW indexes removed from schema
    Given Phases 1 and 2 are complete and all tests pass
    When the infrastructure removal migration runs
    Then no HNSW indexes exist in the database
    And INFO FOR DB shows zero vector indexes

  Scenario: Embedding fields removed from all entity tables
    Given the infrastructure removal migration has run
    When querying any entity table
    Then no "embedding" field exists on any record
    And database storage is reduced

  Scenario: Server starts without embedding model configuration
    Given the EMBEDDING_MODEL environment variable is not set
    And the EMBEDDING_DIMENSION environment variable is not set
    When the Brain server starts
    Then the server starts successfully
    And all API endpoints function correctly
    And no embedding-related errors appear in logs

  @property
  Scenario: No embedding API calls in any code path
    Given the embedding infrastructure has been fully removed
    Then no code path in the application calls createEmbeddingVector
    And no code path imports from "graph/embeddings"
    And the embeddings.ts module does not exist
