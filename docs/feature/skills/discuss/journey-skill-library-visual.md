# Journey: Manage Skill Library

## Persona: Marcus (Workspace Admin)

Manages the workspace skill catalog. Creates skills from GitHub/git sources, reviews their status, updates versions, and governs usage through policies.

## Emotional Arc

```
Start: Purposeful          Middle: Organized          End: Satisfied
"Building expertise"       "Library is taking shape"  "Agents can use these"
```

## Journey Flow

```
[Trigger: Need to add      [Browse Library]        [Create Skill]          [Manage Lifecycle]
 domain expertise]      ->  View catalog        ->  From source ref     ->  Activate/Deprecate
                            Feels: Oriented         Feels: Productive       Feels: In control
```

## Skill Library Page

```
+-- Skill Library ----------------------------------------------+
|                                                                |
|  [+ Create Skill]                                              |
|                                                                |
|  Filter: [All v] [Active v] [Draft v] [Deprecated v]          |
|                                                                |
|  +----------------------------------------------------------+ |
|  | security-audit                    v1.2       active       | |
|  | Comprehensive security audits of code changes             | |
|  | Source: github  acme-corp/agent-skills                    | |
|  | Tools: read_file, search_codebase, check_dependencies     | |
|  | Agents: 3                         Created: 2026-03-15     | |
|  +----------------------------------------------------------+ |
|  | code-review                       v2.0       active       | |
|  | Code quality and maintainability review                   | |
|  | Source: github  acme-corp/agent-skills                    | |
|  | Tools: search_codebase, run_linter                        | |
|  | Agents: 5                         Created: 2026-03-10     | |
|  +----------------------------------------------------------+ |
|  | legacy-migration                  v0.9       draft        | |
|  | Guides legacy system migration planning                   | |
|  | Source: git  https://internal.git/skills                  | |
|  | Tools: (none assigned)                                    | |
|  | Agents: 0                         Created: 2026-03-28     | |
|  +----------------------------------------------------------+ |
|                                                                |
+----------------------------------------------------------------+
```

**Emotional state**: Oriented. Clear view of what expertise the workspace has.

## Create Skill Form

```
+-- Create Skill -----------------------------------------------+
|                                                                |
|  Name*                                                         |
|  [security-audit____________________________]                  |
|                                                                |
|  Description*                                                  |
|  [Performs comprehensive security audits of ________________]  |
|  [code changes. Checks OWASP Top 10, dependency____________]  |
|                                                                |
|  Version*                                                      |
|  [1.0___________]                                              |
|                                                                |
|  Source                                                        |
|  Type: (o) GitHub  ( ) Git                                     |
|                                                                |
|  Repository / URL*                                             |
|  [acme-corp/agent-skills____________________]                  |
|                                                                |
|  Ref (branch/tag/commit)                                       |
|  [v1.2______________]                                          |
|                                                                |
|  Subpath (directory within repo)                               |
|  [skills/security-audit_____________________]                  |
|                                                                |
|  Required Tools                                                |
|  +--------------------------------------------------------+   |
|  | [x] read_file                                          |   |
|  | [x] search_codebase                                    |   |
|  | [x] check_dependencies                                 |   |
|  | [ ] run_linter                                         |   |
|  | [ ] create_branch                                      |   |
|  +--------------------------------------------------------+   |
|                                                                |
|  Status: Draft (activate after review)                         |
|                                                                |
|                           [Cancel]  [Create Skill]             |
+----------------------------------------------------------------+
```

**Emotional state**: Productive. Defining expertise for the workspace.

## Skill Detail Page

```
+-- security-audit  v1.2 ---- active ---------------------------+
|                                                                |
|  Description                                                   |
|  Performs comprehensive security audits of code changes.       |
|  Checks OWASP Top 10, dependency vulnerabilities.             |
|                                                                |
|  Source                                                        |
|  Type: GitHub                                                  |
|  Repository: acme-corp/agent-skills                            |
|  Ref: v1.2                                                     |
|  Subpath: skills/security-audit                                |
|                                                                |
|  Required Tools                                                |
|  read_file, search_codebase, check_dependencies                |
|                                                                |
|  Agents Using This Skill                                       |
|  security-auditor, compliance-checker, pen-tester              |
|                                                                |
|  Governed By                                                   |
|  policy: "Security Tool Access" (active)                       |
|                                                                |
|  Version History                                               |
|  v1.2 (current) -- v1.1 -- v1.0                               |
|                                                                |
|  [Edit]  [Deprecate]  [Create New Version]                     |
+----------------------------------------------------------------+
```

**Emotional state**: Informed. Full picture of what this skill does, who uses it, and how it is governed.

## Error Paths

### Duplicate skill name
Create Skill form shows inline error: "A skill named 'security-audit' already exists in this workspace."

### Invalid source reference
If the source URL or repository format is invalid, the form shows: "Could not validate source. Check the repository path and ref."

### Deprecating a skill in use
When Marcus tries to deprecate a skill assigned to agents: "This skill is assigned to 3 agents. Deprecating it will remove it from their next session. Proceed?" with a confirmation dialog listing affected agents.

### Empty skill library
Shows: "No skills yet. Skills give your agents domain expertise. Create your first skill to get started." with prominent Create Skill button.
