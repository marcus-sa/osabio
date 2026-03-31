# ADR-003: Skill Module Follows Learning System Pattern

## Status

Accepted

## Context

The Skills feature needs a backend module for CRUD operations, lifecycle management, and graph queries. The codebase has established patterns for similar domain modules (learning, policy, behavior, objective). The question is which pattern to follow and how to structure the new module.

### Business Drivers

- **Maintainability**: New module should be immediately recognizable to anyone who has worked on the learning or policy modules
- **Testability**: Query functions must accept injected dependencies for isolated testing
- **Time-to-market**: Following an established pattern reduces design and review time

### Constraints

- Functional paradigm (no classes, no module-level mutable state)
- All query functions take `surreal: Surreal` as first parameter
- Route handlers use factory function pattern (`createXRouteHandlers(deps)`)
- No `null` values -- omit optional fields

## Decision

Create `app/src/server/skill/` following the learning system's module structure:

```
app/src/server/skill/
  skill-route.ts       -- createSkillRouteHandlers(deps): route handler factory
  skill-queries.ts     -- Pure query functions (createSkill, listSkills, getSkillDetail, etc.)
  types.ts             -- Domain types (SkillRecord, SkillListItem, SkillDetail, CreateSkillInput)
```

Specific patterns adopted from the learning system:

1. **Route handler factory**: `createSkillRouteHandlers(deps: ServerDependencies)` returns an object with `handleCreate`, `handleList`, `handleGetDetail`, `handleUpdate`, `handleDelete`, `handleActivate`, `handleDeprecate`, `handleCheckName`
2. **Query function signatures**: Each function takes a single options object: `createSkill(input: { surreal, workspaceRecord, skill, now })`
3. **Error types**: `SkillNotFoundError` and `SkillStatusTransitionError` as named error classes (following `LearningNotFoundError`, `LearningNotActiveError`)
4. **List query with dynamic clauses**: Status filter built dynamically following `listWorkspaceLearnings` pattern
5. **Response mapping**: `toSkillListItem(row)` mapper following `toLearning(row)` pattern

## Alternatives Considered

### Alternative A: Inline skill routes in agent-route.ts

Add skill endpoints directly to the agent module since skills are closely related to agents.

- Pro: Fewer files
- Con: Agent module grows unwieldy (already 320 lines)
- Con: Skills are an independent entity with their own lifecycle, not a sub-resource of agents
- Con: Skill Library UI operates independently of agent creation
- **Rejected**: Skills are a first-class entity with their own CRUD lifecycle, not an agent sub-resource

### Alternative B: Generic entity module with configuration

Create a reusable "governed entity" module that handles any entity with lifecycle + CRUD.

- Pro: Could reduce duplication across learning/skill/policy
- Pro: Future entities would be cheaper to add
- Con: Premature abstraction -- only 2 entities share this pattern so far
- Con: Different enough in details (collision detection for learnings, source references for skills, version chains for policies) that a generic module would need many escape hatches
- Con: Violates "simplest solution first" principle
- **Rejected**: Insufficient pattern repetition to justify abstraction. If a third entity with identical structure appears, revisit.

## Consequences

### Positive

- Developer reading `skill-route.ts` can map it 1:1 to `learning-route.ts` -- zero learning curve
- Code review is faster because the pattern is known
- Acceptance tests can follow the same structure as learning acceptance tests

### Negative

- Some structural duplication between skill and learning modules (factory function, workspace resolution, error handling)
- If the learning pattern is later refactored, skill module must be updated to match

### Trade-offs

- **Duplication vs abstraction**: Accepting structural duplication over premature abstraction. The "Rule of Three" applies -- abstract when three modules share the pattern, not two.
