# Skills × Sandbox Agent Integration Research

**Date**: 2026-03-28
**Issue**: #177 — Skills: graph-native behavioral expertise layer
**Question**: How do Brain's graph-native Skills work with Sandbox Agent's `setSkillsConfig` and `setMcpConfig`/custom tools APIs?

---

## 0. How Claude Code (and Agent Skills-Compatible Clients) Actually Load Skills

**Answer: It's LLM-driven, not client-side semantic search.** The client does zero matching. Here's the exact flow:

### Three-Tier Progressive Disclosure

| Tier | What's loaded | When | Token cost |
|------|--------------|------|------------|
| 1. Catalog | `name` + `description` only | Session start (all skills) | ~50-100 tokens per skill |
| 2. Instructions | Full `SKILL.md` body | When the LLM decides to activate | <5000 tokens recommended |
| 3. Resources | Scripts, references, assets | When instructions reference them | Varies |

### The Activation Mechanism

1. **At session start**: Claude Code scans skill directories and builds a **catalog** — just `name`, `description`, and `location` (path to SKILL.md) for each skill. This catalog is injected into the system prompt or embedded in a dedicated `Skill` tool's description.

2. **The LLM decides**: When a user message arrives, the LLM reads the catalog and **decides on its own** whether any skill is relevant. There is no client-side BM25, no semantic search, no trigger matching. The LLM's judgment is the only activation mechanism.

3. **Two activation patterns**:
   - **File-read activation**: The LLM calls its standard `Read` tool to read the `SKILL.md` file at the catalog path. Simplest approach.
   - **Dedicated tool activation**: A `Skill` tool (registered by the client) takes a skill name and returns the content. Claude Code uses this pattern — the `Skill` tool is constrained to an enum of valid skill names.

4. **Full content loads**: The LLM receives the full markdown body (frontmatter stripped or included, implementation choice). It then follows the instructions.

5. **Resources on demand**: If the skill body references `scripts/extract.py` or `references/REFERENCE.md`, the LLM reads those files individually when needed.

### What This Means for Brain

From the [Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support):

> "Most implementations rely on the model's own judgment as the activation mechanism, rather than implementing harness-side trigger matching or keyword detection."

**Brain's BM25 trigger matching (originally proposed in issue #177) has been removed.** The Agent Skills spec explicitly says clients should NOT do client-side matching — the LLM decides. Brain controls skill *availability* (which skills are materialized via `setSkillsConfig`), not skill *activation* (which the LLM handles natively). Since Brain already gates availability through the `possesses` relation, BM25 trigger matching adds no value — it was solving a problem that doesn't exist.

### Claude Code-Specific Details

From the [Claude Code skills documentation](https://code.claude.com/docs/en/skills):

- **Description budget**: Skill descriptions are loaded into context with a budget of **2% of context window** (fallback: 16,000 characters). If too many skills, some are excluded. Check with `/context`.
- **`disable-model-invocation: true`**: Removes the skill from the catalog entirely — the LLM never sees it. Only user can invoke via `/name`.
- **`user-invocable: false`**: Hides from `/` menu but LLM can still activate it.
- **Context protection**: Skill content is exempt from context compaction/pruning — once loaded, it persists for the session.
- **Deduplication**: Clients track which skills are activated per session to avoid double-loading.

### Implication for Hybrid Strategy

This confirms the hybrid approach (Strategy C) is correct:

1. **Materialize Brain skills as `SKILL.md` files** with good `description` fields — the description is the ONLY activation signal the sandbox agent sees
2. Brain controls skill **availability** via `possesses` → `setSkillsConfig` materialization — only assigned skills are visible to the agent
3. The `description` field must be written for LLM comprehension, not keyword matching — it should explain **what the skill does AND when to use it**
4. Brain enforces governance at three layers: assignment (`possesses`), tool gating (MCP `tools/list` filtering), and policy enforcement (`governs_skill` at tool-call time)

### Sources for This Section

| Source | Reputation | Key Claim |
|--------|-----------|-----------|
| [Agent Skills Spec: Client Implementation](https://agentskills.io/client-implementation/adding-skills-support) | High (official spec) | "Most implementations rely on the model's own judgment... rather than harness-side trigger matching" |
| [Agent Skills: What Are Skills](https://agentskills.io/what-are-skills) | High (official spec) | Progressive disclosure: name+description at startup, full content on activation |
| [Claude Code: Skills Documentation](https://code.claude.com/docs/en/skills) | High (official docs) | Description budget = 2% of context window, `disable-model-invocation` removes from catalog |

---

## 1. Two Systems, Two Skill Models

### Brain Skills (Issue #177)

Brain Skills are **graph-native expertise documents** with governed lifecycle:

| Aspect | Design |
|--------|--------|
| Storage | `skill` table (metadata + source reference) — no file content stored |
| Resolution | Sandbox agent resolves files from source at session time (GitHub, git, local) |
| Metadata | `name`, `description`, `version` extracted into typed fields for querying |
| Activation | LLM-decided via `description` field (Agent Skills native) |
| Tool binding | `skill_requires` relation edges to `mcp_tool` records |
| Assignment | `possesses` relation (identity → skill) |
| Governance | `governs_skill` relation (policy → skill) |
| Lifecycle | `draft` → `active` → `deprecated` with version chain (`skill_supersedes`) |
| Implicit grants | Possessing a skill grants its required tools: `can_use ∪ (possesses → skill_requires)` |

#### Source Reference Architecture

Brain stores skill metadata + source references. The sandbox agent handles file resolution (downloading from GitHub, git, or local paths). Brain never stores or materializes skill file content — it's a metadata and governance layer.

```typescript
// Skill source stored in Brain's skill table
{
  name: "security-audit",
  description: "Performs comprehensive security audit of code changes...",
  version: "1.2",
  status: "active",
  source: {
    type: "github",
    source: "acme-corp/agent-skills",
    ref: "v1.2",         // pinned version
    subpath: "skills/security-audit",
  },
}

// At session setup, Brain passes source directly to sandbox agent SDK
await adapter.setSkillsConfig(worktreePath, "brain-skills", {
  sources: activeSkills.map(skill => skill.source),
});
```

Brain-authored skills (created via UI/API with inline content) are deferred to #200. The MVP covers imported skills only.

### Sandbox Agent Skills (`setSkillsConfig`)

Sandbox Agent skills are **file-based instruction bundles** following the [Agent Skills spec](https://agentskills.io/specification):

```typescript
// SDK types (from sandbox-agent@^0.4.0)
type SkillSource = {
  type: string;       // "github" | "local" | "git"
  source: string;     // "owner/repo" | "/path" | "https://..."
  ref?: string;       // branch/tag/commit
  skills?: string[];  // subset selection
  subpath?: string;   // subdirectory within repo
};

type SkillsConfig = {
  sources: SkillSource[];
};

// Keyed by (directory, skillName)
sdk.setSkillsConfig(
  { directory: "/workspace", skillName: "default" },
  { sources: [{ type: "github", source: "anthropics/skills" }] }
);
```

The Agent Skills spec defines `SKILL.md` files with YAML frontmatter:

```yaml
---
name: skill-name           # required, 1-64 chars, lowercase+hyphens
description: What it does   # required, 1-1024 chars
license: Apache-2.0         # optional
compatibility: Requires git  # optional, environment requirements
metadata:                    # optional, arbitrary key-value
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read  # optional, experimental
---

[Markdown instructions body]
```

Progressive disclosure model:
1. **Metadata** (~100 tokens): `name` + `description` loaded at startup for all skills
2. **Instructions** (<5000 tokens): full SKILL.md body loaded on activation
3. **Resources** (as needed): `scripts/`, `references/`, `assets/` loaded on demand

### Sandbox Agent Custom Tools (`setMcpConfig`)

MCP servers are registered per-directory and auto-discovered by sessions:

```typescript
// Remote MCP server (Brain's current pattern)
sdk.setMcpConfig(
  { directory: "/workspace", mcpName: "brain" },
  {
    type: "remote",
    url: "https://brain.example/mcp/agent/session-id",
    headers: { "X-Brain-Auth": "token" },
  }
);

// Local MCP server (stdio)
sdk.setMcpConfig(
  { directory: "/workspace", mcpName: "customTools" },
  {
    type: "local",
    command: "node",
    args: ["/opt/mcp/custom-tools/mcp-server.cjs"],
  }
);
```

Both configs are directory-scoped: sessions inherit configs matching their `cwd`.

---

## 2. Current Brain → Sandbox Agent Integration

Today, Brain's orchestrator (`session-lifecycle.ts:456-466`) does two things before session creation:

```typescript
// 1. Register Brain's MCP server for the sandbox agent to call
await adapter.setMcpConfig(worktreePath, "brain", {
  type: "remote",
  url: `${input.brainBaseUrl}/mcp/agent/${agentSessionId}`,
  headers: { "X-Brain-Auth": input.mcpAuthToken },
});

// 2. Create the sandbox session in the worktree
handle = await adapter.createSession({
  agent: input.sandboxAgentType ?? "claude",
  cwd: worktreePath,
  ...(input.env ? { env: input.env } : {}),
});
```

The adapter interface (`sandbox-adapter.ts`) exposes `setMcpConfig` but **does NOT expose `setSkillsConfig`** — skills are not wired yet.

---

## 3. Integration Strategies

There are three viable approaches to make Brain Skills work with Sandbox Agent sessions. They are **not mutually exclusive** — the recommended path combines all three.

### Strategy A: Inject Brain Skills as Local SKILL.md Files (setSkillsConfig)

**Concept**: Before session creation, materialize Brain's active skills as `SKILL.md` files on disk, then register them via `setSkillsConfig` with `type: "local"`.

**Flow**:
1. Session assignment triggers → resolve agent's active skills via `possesses` + `skill.status = "active"`
2. For each skill, write `SKILL.md` to a temporary directory:
   ```
   /tmp/brain-skills/{session-id}/{skill-name}/SKILL.md
   ```
3. Register via `setSkillsConfig`:
   ```typescript
   await adapter.setSkillsConfig(worktreePath, "brain-skills", {
     sources: activeSkills.map(skill => ({
       type: "local",
       source: `/tmp/brain-skills/${sessionId}/${skill.name}`,
     })),
   });
   ```
4. Session discovers skills via native Agent Skills resolution

**SKILL.md generation from Brain skill record**:
```markdown
---
name: ${skill.name}
description: ${skill.description}
allowed-tools: ${derivedFromSkillRequires}
metadata:
  brain-skill-id: ${skill.id}
  brain-version: ${skill.version}
  brain-workspace: ${workspaceId}
---

${skill.content}
```

**Advantages**:
- Uses the native Agent Skills discovery path — skill activation is handled by the sandbox agent (Claude Code, Codex, etc.), not Brain
- `allowed-tools` frontmatter can pre-approve MCP tools the skill needs
- Progressive disclosure is handled by the agent runtime (metadata scanned first, body loaded on activation)
- Works with any Agent Skills-compatible agent (Claude Code, Cursor, Codex, OpenCode, Amp, etc.)

**Disadvantages**:
- Brain controls availability (which skills are materialized) but the sandbox agent decides when to activate
- `description` field is the primary activation signal (must be carefully authored for LLM comprehension)
- Governance happens at three layers: assignment (`possesses`), tool gating (MCP `tools/list`), and policy enforcement at tool-call time

### Strategy B: Inject Skills via Brain's MCP Context (Current MCP Path)

**Concept**: Brain's existing `/mcp/agent/{sessionId}` endpoint already injects context (decisions, tasks, learnings) into the agent's prompt. Extend this to include matched skills.

**Flow**:
1. Agent calls `mcp/context` → Brain resolves task context
2. Brain runs BM25 trigger matching against the task description/intent
3. Matched skills are injected as structured context alongside decisions and learnings
4. `skill_requires` edges are used to filter the MCP `tools/list` response — only expose tools the agent's skills need plus direct `can_use` grants

**Implementation in existing architecture**:
```typescript
// In context resolution (mcp/agent-mcp-route.ts or context handler)
const agentSkills = await resolveAgentSkills(surreal, identityRecord, workspaceRecord, taskDescription);
// Returns: Array<{ name, content, requiredTools }>

// Add to context response
context.skills = agentSkills.map(s => ({
  name: s.name,
  instructions: s.content,
}));

// Filter tools/list to include skill-derived tools
const effectiveTools = union(directGrants, skillDerivedTools);
```

**Advantages**:
- Brain controls activation (BM25 triggers) and governance (`governs_skill` policy check)
- Implicit tool grants work naturally — `skill_requires` edges filter the MCP `tools/list`
- Fits existing architecture without new adapter surface area
- Skills can reference Brain-specific context (observations, decisions) that file-based skills can't

**Disadvantages**:
- Skills are injected as prompt context, not as native Agent Skills — the sandbox agent doesn't "know" about them as skills
- No progressive disclosure — all matched skill content lands in the context at once
- Tightly coupled to Brain's MCP protocol

### Strategy C: Hybrid — Native Skills + MCP Tool Gating (Recommended)

**Concept**: Use both paths. Materialize skills as `SKILL.md` files for native agent discovery (Strategy A), AND use Brain's MCP layer to enforce tool gating and governance (Strategy B's tool filtering).

**Flow**:
1. **Pre-session**: Materialize active skills as `SKILL.md` → `setSkillsConfig` (Strategy A)
2. **Pre-session**: Register Brain MCP server → `setMcpConfig` (existing)
3. **Runtime**: Sandbox agent activates skills natively via its own heuristics
4. **Runtime**: When agent calls MCP `tools/list`, Brain returns only tools the agent's skills authorize (`can_use ∪ skill_requires`)
5. **Runtime**: When agent calls a tool, Brain's intent authorization checks the `governs_skill` policy
6. **Post-session**: Skill usage telemetry flows back via `skill_evidence` edges

**Why this is the best of both worlds**:

| Concern | Strategy A alone | Strategy B alone | Hybrid (C) |
|---------|-----------------|-----------------|------------|
| Native skill discovery | Yes | No | Yes |
| Brain-controlled availability | Yes (via materialization) | Yes (via MCP context) | Yes (materialization + MCP tool gating) |
| Governance at tool-call time | No | Yes | Yes |
| Progressive disclosure | Yes (agent-native) | No | Yes |
| Cross-agent compatibility | Yes | Brain-only | Yes |
| Implicit tool grants | File-only (`allowed-tools`) | Graph-native (`skill_requires`) | Both |

---

## 4. Adapter Changes Required

### New adapter port: `setSkillsConfig`

```typescript
// sandbox-adapter.ts — extend SandboxAgentAdapter
export type SkillSource = {
  readonly type: "local" | "github" | "git";
  readonly source: string;
  readonly ref?: string;
  readonly skills?: string[];
  readonly subpath?: string;
};

export type SkillsConfig = {
  readonly sources: readonly SkillSource[];
};

export type SandboxAgentAdapter = {
  // ... existing methods ...
  setMcpConfig: (directory: string, name: string, config: McpServerConfig) => Promise<void>;

  /** Configure skill sources for a directory. Sessions inheriting this cwd discover these skills. */
  setSkillsConfig: (directory: string, name: string, config: SkillsConfig) => Promise<void>;
  deleteSkillsConfig: (directory: string, name: string) => Promise<void>;
};
```

### Production adapter wiring

```typescript
// In createSandboxAgentAdapter()
setSkillsConfig: async (directory, name, config) => {
  await sdk.setSkillsConfig({ directory, skillName: name }, config);
},
deleteSkillsConfig: async (directory, name) => {
  await sdk.deleteSkillsConfig({ directory, skillName: name });
},
```

### Mock adapter extension

```typescript
// In createMockAdapter()
const skillsConfigs = new Map<string, SkillsConfig>();

setSkillsConfig: async (directory, name, config) => {
  skillsConfigs.set(`${directory}:${name}`, config);
},
deleteSkillsConfig: async (directory, name) => {
  skillsConfigs.delete(`${directory}:${name}`);
},
```

---

## 5. Session Lifecycle Changes

### Session setup — pass source references to sandbox agent

Brain passes source references directly to the sandbox agent SDK. The sandbox agent handles downloading and resolving files — Brain never touches skill file content at session time.

```typescript
// session-lifecycle.ts — in assignTask(), after worktree creation

// 1. Resolve agent's active skills
const activeSkills = await resolveActiveSkills(input.surreal, identityRecord, workspaceRecord);

// 2. Register skill sources with Sandbox Agent (it handles file resolution)
if (activeSkills.length > 0) {
  await adapter.setSkillsConfig(worktreePath, "brain-skills", {
    sources: activeSkills.map(skill => skill.source),
  });
}

// 3. Register Brain MCP server (existing)
await adapter.setMcpConfig(worktreePath, "brain", { ... });

// 4. Create session (existing)
handle = await adapter.createSession({ ... });
```

This is significantly simpler than the previous bucket-based approach — no file reads, no filesystem writes, no materialization code. Brain is a metadata + governance layer; the sandbox agent owns file resolution.

---

## 6. MCP Tool Gating (Governance Layer)

Even with native skill activation, Brain's MCP layer enforces which tools the agent can actually call. This is the governance gate that Strategy A alone lacks.

### Effective tool resolution

When the sandbox agent calls `tools/list` on Brain's MCP endpoint:

```typescript
// agent-mcp-route.ts or scope-engine.ts

// 1. Direct tool grants (existing)
const directGrants = await query("SELECT out AS tool FROM can_use WHERE in = $identity", { identity });

// 2. Skill-derived tool grants (new)
const skillDerivedTools = await query(`
  SELECT ->skill_requires->mcp_tool AS tool
  FROM possesses
  WHERE in = $identity AND out.status = "active"
`, { identity });

// 3. Union = effective toolset
const effectiveTools = union(directGrants, skillDerivedTools);

// 4. Return only these tools in tools/list response
return allWorkspaceTools.filter(t => effectiveTools.has(t.id));
```

### Policy enforcement at call time

When the agent calls a tool that came from a skill:

```typescript
// In tool call handler
const sourceSkill = await query(`
  SELECT <-skill_requires<-skill AS skill
  FROM $tool
  WHERE skill.status = "active"
  AND skill IN (SELECT out FROM possesses WHERE in = $identity)
`, { tool: toolRecord, identity });

if (sourceSkill) {
  // Check governs_skill policy
  const policy = await query("SELECT in AS policy FROM governs_skill WHERE out = $skill", { skill: sourceSkill.id });
  if (policy) {
    await evaluatePolicy(policy, intent, context);
  }
}
```

---

## 7. Import Path: Community Skills → Brain Graph

Issue #177 specifies compatibility with the 80k+ skills.sh ecosystem. With this integration:

### Inbound: skills.sh → Brain

The import flow fetches the SKILL.md (read-only) to extract metadata, then stores the source reference:

```typescript
// Import flow
// 1. Admin imports a skill from skills.sh
const skillSource = { type: "github", source: "anthropics/skills", skills: ["code-review"], ref: "v1.0" };

// 2. Brain fetches SKILL.md from source (read-only — not stored)
const rawSkillMd = await fetchRawFile(skillSource, "SKILL.md");
const parsed = parseSkillMd(rawSkillMd);

// 3. Create graph node with extracted metadata + source reference
await query(`CREATE skill CONTENT $content`, {
  content: {
    name: parsed.name,
    description: parsed.description,
    version: parsed.metadata?.version ?? "1.0",
    status: "draft",  // Human reviews before activation
    workspace: workspaceRecord,
    source: skillSource,  // Source reference — sandbox agent resolves at session time
  }
});

// 4. LLM analyzes tool requirements → creates skill_requires edges
await analyzeToolRequirements(skill, workspaceTools);
```

### Outbound: Brain Skill → Sandbox Agent session

The session setup flow in Section 5 passes source references directly to `setSkillsConfig`. The sandbox agent downloads and resolves files.

### Flow: skills.sh → Brain → sandbox agent

```
skills.sh / GitHub registry
  ↓ admin imports: Brain fetches SKILL.md (read-only) to extract metadata
Brain SurrealDB (skill table: name, description, version, source ref)
  ↓ session setup: pass source ref to setSkillsConfig
Sandbox Agent SDK (handles file download/resolution)
  ↓ native discovery (Agent Skills spec)
Agent activates skill based on task context
  ↓ tool calls flow through Brain MCP
Brain enforces governance (intent auth + policy)
```

**Key simplification**: Brain never stores skill file content. It fetches once on import to extract metadata, then the sandbox agent fetches from source at session time. Version pinning via `ref` ensures reproducibility.

---

## 8. What About Custom Tools (Non-MCP)?

Sandbox Agent's custom tools page describes a simpler pattern: a script + `SKILL.md` that agents invoke directly (not via MCP). Example:

```
/opt/skills/random-number/
├── random-number.cjs    # Script
└── SKILL.md             # Instructions + invocation command
```

The `SKILL.md` body contains: `Run: node /opt/skills/random-number/random-number.cjs <min> <max>`

**Relevance to Brain**: With the source-reference approach, this works naturally. The source repo contains both the SKILL.md and companion scripts. The sandbox agent resolves the full directory from the source reference — Brain doesn't need to know about individual companion files.

```typescript
// Source reference points to skill directory containing SKILL.md + scripts
{
  type: "github",
  source: "acme-corp/agent-skills",
  ref: "v1.0",
  subpath: "skills/random-number",  // Contains SKILL.md + random-number.cjs
}
```

The sandbox agent's native resolution handles the full directory structure. No Brain-side materialization needed.

---

## 9. Implementation Phases (Aligned with #177)

| #177 Phase | Integration Work |
|------------|-----------------|
| 1. Schema | No change — schema already supports what's needed |
| 2. CRUD routes | No change |
| 3. Materialization | SKILL.md generation + `setSkillsConfig` registration (Strategy A) |
| 4. Tool requirement analysis | `skill_requires` edges feed `allowed-tools` generation |
| 5. Missing tool resolution | Surface gaps when materializing SKILL.md |
| 6. Context injection | **New**: materialize → `setSkillsConfig` (Strategy A) + MCP tool filtering (Strategy B) |
| 7. Governance | `governs_skill` evaluated at MCP tool-call time |
| 8. Import (skills.sh) | Parse SKILL.md → graph node → round-trip back to SKILL.md for sessions |
| 9. Evolution | Observer proposes updates → new version → rematerialized on next session |
| 10. UI | Show which skills were activated in session telemetry |

**Phase 6 is the key integration point** — this is where Brain Skills meet Sandbox Agent.

---

## 10. Key Decisions (Resolved)

### D1: Single vs dual activation path — RESOLVED: Hybrid (C)

Brain controls skill **availability** (which skills are materialized via `setSkillsConfig`), the sandbox agent's LLM controls **activation** (which skills to load based on task context), and Brain enforces **governance** at MCP tool-call time. No BM25 trigger matching needed — the `possesses` relation is the availability gate, the `description` field is the activation signal.

### D2: Skill storage — RESOLVED: Source references only (no file storage)

Three options were evaluated:
- `content: string` field: simple but creates lossy round-trip on import
- SurrealDB bucket files: byte-for-byte preservation but adds complexity + experimental `--allow-experimental files` flag
- Source references: store `{ type, source, ref, subpath }` — sandbox agent resolves files at session time
- **Decision**: Source references. Brain stores metadata + source pointer. The sandbox agent already knows how to fetch from GitHub/git/local. Brain's value is governance and metadata, not file hosting.
- **Rationale**: Simplest path to MVP. No file lifecycle management, no bucket setup, no materialization code. Version pinning via `ref` ensures reproducibility.
- **Deferred**: Brain-authored skills (inline content via UI/API) require solving where generated SKILL.md files live. Tracked in #200.

### D3: `allowed-tools` generation

The Agent Skills spec's `allowed-tools` field is experimental. Options:
- Generate from `skill_requires` edges (e.g., `Bash(node:*) Read Write`)
- Omit and rely on Brain's MCP `tools/list` filtering instead
- **Recommendation**: Generate `allowed-tools` as a hint for the agent runtime, but enforce via MCP `tools/list` filtering regardless. Belt and suspenders.

### D4: Script/companion file support — RESOLVED: Handled by sandbox agent

- The source reference points to a directory containing SKILL.md + any companion files. The sandbox agent's native resolution handles the full directory structure.
- Brain doesn't need to know about individual companion files — it only extracts metadata from the SKILL.md.

---

## Sources

| Source | Type | Accessed |
|--------|------|----------|
| [GitHub Issue #177](https://github.com/conductor-is/brain/issues/177) | Primary | 2026-03-28 |
| [Sandbox Agent Skills Config](https://sandboxagent.dev/docs/skills-config) | Official docs | 2026-03-28 |
| [Sandbox Agent Custom Tools](https://sandboxagent.dev/docs/custom-tools) | Official docs | 2026-03-28 |
| [Sandbox Agent OpenAPI spec](https://sandboxagent.dev/docs/openapi.json) | Official spec | 2026-03-28 |
| [Agent Skills Specification](https://agentskills.io/specification) | Official spec | 2026-03-28 |
| [SurrealDB Files Datamodel](https://surrealdb.com/docs/surrealql/datamodel/files) | Official docs (v3.0) | 2026-03-28 |
| `sandbox-agent@^0.4.0` SDK types (`dist/index.d.ts`) | Installed package | 2026-03-28 |
| `app/src/server/orchestrator/sandbox-adapter.ts` | Codebase | 2026-03-28 |
| `app/src/server/orchestrator/session-lifecycle.ts` | Codebase | 2026-03-28 |
