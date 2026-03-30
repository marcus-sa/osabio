# DISCOVER Decisions — skills

## Key Decisions
- [D1] 3-step wizard (Config > Skills > Tools) over single-page form or post-creation panel: mirrors the conceptual layers (identity > expertise > capabilities) and keeps steps skippable (see: solution-testing.md)
- [D2] Minimal checklist for skill assignment in Step 2 over searchable catalog: right for MVP when workspace has <20 skills (see: opportunity-tree.md)
- [D3] Two-section tool display in Step 3 (skill-derived read-only + manual selection): shows implicit tool grants transparently while allowing direct `can_use` grants (see: solution-testing.md)
- [D4] Steps 2 and 3 are skippable: external agents don't use skills, new sandbox agents may not have skills yet (see: solution-testing.md)
- [D5] Runtime selection consolidated into Step 1 as radio group: eliminates the current separate runtime screen, making room for the 2 new steps without increasing total steps to 4 (see: solution-testing.md)

## Constraints Established
- Skills CRUD must follow the same pattern as the Learning system (lifecycle, governance, JIT loading)
- Source-reference architecture only — Brain stores metadata + source pointer, never file content (confirmed by research)
- LLM-driven activation — Brain controls skill *availability*, not *activation* (Agent Skills spec confirms)
- Agent creation transaction must remain atomic — skill `possesses` edges added in same transaction
- No local skill sources in MVP — only `github` and `git` source types. Local skills delegated to separate work.

## Validated Assumptions
- A5: LLM-driven activation is sufficient (High confidence — confirmed by Agent Skills spec and Claude Code docs)
- A7: Source-reference architecture is viable (High confidence — sandbox agent SDK supports `setSkillsConfig`)
- A10: Sandbox config belongs in step 1 (High confidence — it's runtime-specific config, same conceptual level)

## Invalidated Assumptions
- None invalidated — all assumptions remain plausible pending prototype validation

## Open Assumptions (Require Prototype Testing)
- A2: Three discrete wizard steps is the right granularity (Score: 13 — test with T1-T5 scenarios)
- A1: Admins prefer creation-time skill assignment over post-creation (Score: 11 — track usage rate)
- A6: Implicit tool grants are intuitive to admins (Score: 11 — H3 is the primary usability risk)
