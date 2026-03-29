# Opportunity Scoring: Claude Agent SDK Migration

## Scoring Method

ODI (Outcome-Driven Innovation): Importance (1-10) vs Satisfaction (1-10)
Opportunity = Importance + max(Importance - Satisfaction, 0)

| Job | Importance | Current Satisfaction | Opportunity Score | Priority |
|-----|-----------|---------------------|-------------------|----------|
| J1: Orchestrator spawns agent | 10 | 3 | 17 | **Highest** |
| J3: Lifecycle hooks sync Osabio | 9 | 4 | 14 | **High** |
| J2: Developer init setup | 6 | 5 | 7 | Medium |

## Analysis

**J1 dominates**: The orchestrator spawn is the core runtime path. Current satisfaction is very low — multi-step process startup, fragile stdout parsing, missing hooks, proprietary event format. The Agent SDK's `query()` eliminates all of this.

**J3 is tightly coupled to J1**: Hooks are configured as part of the `query()` options. Solving J1 automatically enables J3. The gap is large because 3/6 required hooks are currently missing.

**J2 is lower priority**: Developer init is a one-time setup command. The current approach works (generates files). The main improvement is simplification (fewer files to generate). Can be addressed after J1+J3.

## Recommended Sequencing

1. **J1 + J3 together** — Replace `spawn-opencode.ts` with Agent SDK `query()`, configure hooks inline
2. **J2 after** — Update `osabio init` to remove OpenCode artifacts, add Agent SDK guidance
