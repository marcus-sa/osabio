# ADR-002: Source-Reference Architecture for Skill Storage

## Status

Accepted (inherited from DISCOVER wave, formalized here)

## Context

Skills are domain expertise documents following the Agent Skills specification. Each skill consists of a `SKILL.md` file (with YAML frontmatter and markdown instructions) plus optional companion resources (scripts, references). The system needs to store skills in SurrealDB and make them available to sandbox agents at session time.

The core question is what Osabio stores about a skill and how the skill content reaches the sandbox agent.

### Business Drivers

- **Time-to-market**: The simplest approach that works end-to-end wins
- **Maintainability**: Less stored state means fewer synchronization problems
- **Compatibility**: Skills must work with any Agent Skills-compatible client (Claude Code, Codex, etc.)

### Constraints

- Sandbox Agent SDK provides `setSkillsConfig` which accepts source references (`{ type, source, ref, subpath }`)
- The SDK handles downloading and resolving files from GitHub/git sources
- SurrealDB file buckets are experimental (require `--allow-experimental files` flag)
- Brain-authored skills with inline content are deferred to #200

## Decision

Osabio stores **metadata plus source pointer** for each skill. It never stores or materializes skill file content. At session time, source references are passed directly to the Sandbox Agent SDK via `setSkillsConfig`, and the SDK handles file resolution.

### What Osabio stores (skill table)

- `name`, `description`, `version` -- extracted from SKILL.md at import time for graph queries and UI display
- `source` -- the pointer: `{ type: "github"|"git", source: "owner/repo"|"url", ref?: "v1.2", subpath?: "skills/audit" }`
- `status`, `workspace`, `created_by`, `created_at`, `updated_at` -- governance and lifecycle metadata

### What Osabio does NOT store

- SKILL.md file content
- Companion files (scripts, references, assets)
- Resolved/compiled skill artifacts

### Session-time flow

```
Osabio reads: possesses edges -> skill records -> source references
Osabio calls: adapter.setSkillsConfig(worktreePath, "brain-skills", { sources })
SDK handles:  download from GitHub/git -> resolve SKILL.md -> make available to agent
```

## Alternatives Considered

### Alternative A: Store SKILL.md content in a `content: string` field

Store the full SKILL.md body as a text field on the skill record.

- Pro: Self-contained -- no external dependency for content
- Pro: Enables Brain-authored skills immediately
- Con: Lossy round-trip on import (frontmatter parsing then re-generation)
- Con: Companion files (scripts, references) cannot be stored this way
- Con: Content synchronization problem when upstream repo updates
- Con: Materialization code needed to write SKILL.md to disk before session
- **Rejected**: Adds complexity for MVP where all skills are imported from repositories

### Alternative B: SurrealDB bucket files (byte-for-byte storage)

Store SKILL.md and companion files in SurrealDB's experimental file bucket system.

- Pro: Byte-for-byte preservation -- no lossy round-trips
- Pro: All data in one database
- Con: Requires `--allow-experimental files` flag on SurrealDB
- Con: Experimental feature -- risk of breaking changes
- Con: File lifecycle management adds operational complexity
- Con: Still need materialization code to write files to disk for the sandbox agent
- **Rejected**: Experimental status + unnecessary complexity for source-referenced skills

### Alternative C: Source references only (selected)

Store metadata + source pointer. SDK resolves files.

- Pro: Simplest implementation -- no file handling, no materialization
- Pro: Version pinning via `ref` ensures reproducibility
- Pro: SDK already knows how to fetch from GitHub/git/local
- Pro: Companion files handled naturally (SDK resolves full directory)
- Con: Cannot support Brain-authored skills with inline content (deferred to #200)
- Con: Requires network access at session time (SDK fetches from source)

## Consequences

### Positive

- Zero file lifecycle management in Osabio -- the SDK owns file resolution
- No materialization code needed for MVP
- Skills automatically include companion files (scripts, references) because the SDK resolves the full directory
- Version pinning via `ref` field ensures reproducible skill content across sessions

### Negative

- Brain-authored skills (UI/API-created with inline content) require a separate solution (#200)
- If the source repository is unavailable at session time, the sandbox agent cannot load the skill
- `description` field is the only activation signal available to the LLM -- must be carefully authored

### Trade-offs

- **Simplicity vs capability**: Source-reference-only means no inline skill editing. This is acceptable for MVP where all skills come from repositories. #200 adds inline content support later.
- **Decoupling vs availability**: Osabio is decoupled from file content, but session-time availability depends on source repository access. For production, recommend version-pinned refs to stable tags.
