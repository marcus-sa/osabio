# Acceptance Scenarios: Skills Feature (#177)

## Scenario Inventory

| # | Category | Scenario | Type | Tag |
|---|----------|----------|------|-----|
| WS-1 | Walking Skeleton | Admin creates skill and assigns it to a new agent | walking_skeleton | |
| WS-2 | Walking Skeleton | Admin creates agent with skills and verifies effective toolset | walking_skeleton | |
| WS-3 | Walking Skeleton | Skill lifecycle governs agent creation visibility | walking_skeleton | |
| C-1 | Skill CRUD | Admin creates skill with source reference and required tools | happy | |
| C-2 | Skill CRUD | Admin lists workspace skills | happy | |
| C-3 | Skill CRUD | Admin lists skills filtered by status | happy | |
| C-4 | Skill CRUD | Admin retrieves skill detail with tools, agents, governance | happy | |
| C-5 | Skill CRUD | Admin updates skill metadata and version | happy | |
| C-6 | Skill CRUD | Admin deletes skill with no agent assignments | happy | |
| C-7 | Skill CRUD | Duplicate skill name within workspace is rejected | error | |
| C-8 | Skill CRUD | Creating skill with missing required fields is rejected | error | |
| C-9 | Skill CRUD | Deleting skill that is assigned to agents is rejected | error | |
| C-10 | Skill CRUD | Skill not found returns proper error | error | |
| C-11 | Skill CRUD | Skill created with no required tools has zero skill_requires edges | edge | |
| L-1 | Skill Lifecycle | Activate a draft skill | happy | |
| L-2 | Skill Lifecycle | Deprecate an active skill | happy | |
| L-3 | Skill Lifecycle | Activating a non-draft skill is rejected | error | |
| L-4 | Skill Lifecycle | Deprecating a non-active skill is rejected | error | |
| L-5 | Skill Lifecycle | Deprecated skill is excluded from active skill listing | edge | |
| A-1 | Agent Creation | Create agent with skills creates possesses edges | happy | |
| A-2 | Agent Creation | Create agent with additional tools creates can_use edges | happy | |
| A-3 | Agent Creation | Create agent with no skills and no tools succeeds | happy | |
| A-4 | Agent Creation | Deprecated skill blocks agent creation | error | |
| A-5 | Agent Creation | Non-existent skill blocks agent creation | error | |
| A-6 | Agent Creation | Agent detail returns assigned skills | happy | |
| T-1 | Effective Toolset | Skill-derived tools resolved from skill_requires edges | happy | |
| T-2 | Effective Toolset | Multiple skills sharing a tool produce deduplicated toolset | edge | @property |
| T-3 | Effective Toolset | Agent effective tools is union of skill-derived and can_use | happy | |
| G-1 | Policy Governance | governs_skill relation links policy to skill | happy | |
| G-2 | Policy Governance | Skill detail shows governing policy | happy | |
| G-3 | Policy Governance | Skill with no governing policy shows empty governance | edge | |

## Ratio Analysis

- Total scenarios: 31
- Happy path: 17 (55%)
- Error path: 8 (26%)
- Edge/boundary: 6 (19%)
- Error + Edge: 14 (45%) -- exceeds 40% threshold

## Walking Skeletons (3)

Each skeleton answers: "Can a workspace admin accomplish this goal and see the result?"

**WS-1**: Admin creates a skill, activates it, and confirms it appears in the workspace catalog.
**WS-2**: Admin creates skill with tools, creates agent with that skill, and verifies the agent's effective toolset includes skill-derived tools.
**WS-3**: Admin creates skill, activates it (visible for assignment), deprecates it (excluded from assignment), confirming lifecycle governs availability.

## Driving Ports

All tests invoke through HTTP API endpoints (the application's driving ports):

| Port | Endpoint |
|------|----------|
| Skill CRUD | `POST/GET/PUT/DELETE /api/workspaces/:wsId/skills[/:skillId]` |
| Skill Lifecycle | `POST /api/workspaces/:wsId/skills/:skillId/activate` |
| Skill Lifecycle | `POST /api/workspaces/:wsId/skills/:skillId/deprecate` |
| Name Check | `GET /api/workspaces/:wsId/skills/check-name?name=...` |
| Agent Creation | `POST /api/workspaces/:wsId/agents` |
| Agent Detail | `GET /api/workspaces/:wsId/agents/:agentId` |

SurrealDB direct queries used only for verification of outcomes and test data setup (not as driving ports).

## Domain Language Glossary

| Term | Meaning |
|------|---------|
| Skill | A unit of domain expertise with source reference and required tools |
| Source reference | Pointer to external repository (GitHub/Git) containing skill files |
| Required tools | MCP tools that a skill needs to function |
| Possesses | Relation linking an agent identity to a skill |
| Skill-derived tools | Tools an agent gains through skill_requires edges of possessed skills |
| Additional tools | Tools manually granted via can_use edges (not from skills) |
| Effective toolset | Union of skill-derived and additional tools |
| governs_skill | Relation linking a policy to a skill for governance |

## Implementation Sequence

One-at-a-time enablement order:

1. WS-1 (walking skeleton: create + activate + list)
2. C-1 (create with source and tools)
3. C-2 (list skills)
4. L-1 (activate draft)
5. C-7 (duplicate name rejection)
6. C-4 (skill detail)
7. C-5 (update metadata)
8. C-6 (delete skill)
9. L-2 (deprecate active)
10. L-3 (invalid activation rejection)
11. L-4 (invalid deprecation rejection)
12. WS-2 (walking skeleton: agent with skills + toolset)
13. A-1 (agent with possesses edges)
14. A-2 (agent with can_use edges)
15. A-3 (agent with no skills/tools)
16. A-4 (deprecated skill blocks creation)
17. T-1 (skill-derived tool resolution)
18. T-2 (tool deduplication)
19. T-3 (effective toolset union)
20. WS-3 (walking skeleton: lifecycle governs visibility)
21. G-1 (governs_skill relation)
22. G-2 (skill detail shows governance)
23. Remaining error/edge cases (C-3, C-8, C-9, C-10, C-11, L-5, A-5, A-6, G-3)
