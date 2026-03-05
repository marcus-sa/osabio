import { existsSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

const MAP_MARKER_START = "<!-- brain-map-start -->";
const MAP_MARKER_END = "<!-- brain-map-end -->";
const SUPPORTED_TYPES = ["project", "feature"] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

type EntityDetail = {
  entity: {
    id: string;
    kind: string;
    name: string;
    data: Record<string, unknown>;
  };
  relationships: Array<{
    id: string;
    kind: string;
    name: string;
    relationKind: string;
    direction: "incoming" | "outgoing";
    confidence: number;
  }>;
  provenance: unknown[];
};

// ---------------------------------------------------------------------------
// brain map <dir> <type:id> [--project <id>]
// ---------------------------------------------------------------------------

export async function runMap(): Promise<void> {
  const args = process.argv.slice(2); // ["map", "<dir>", "<type:id>", ...]
  const dirArg = args[1];
  const entityArg = args[2];

  if (!dirArg || !entityArg) {
    console.error("Usage: brain map <directory> <type:id> [--project <id>]");
    console.error("Example: brain map ./services/auth project:abc123");
    console.error("         brain map ./services/auth/oauth feature:def456 --project abc123");
    console.error("Types: project, feature");
    process.exit(1);
  }

  // Parse --project flag
  const projectFlagIdx = args.indexOf("--project");
  const projectId = projectFlagIdx !== -1 ? args[projectFlagIdx + 1] : undefined;
  if (projectFlagIdx !== -1 && !projectId) {
    console.error("--project requires a project ID");
    process.exit(1);
  }

  // Validate directory
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }

  // Parse entity reference
  const colonIdx = entityArg.indexOf(":");
  if (colonIdx === -1) {
    console.error("Entity must be in type:id format (e.g. project:abc123)");
    process.exit(1);
  }

  const entityType = entityArg.slice(0, colonIdx) as SupportedType;
  const entityRawId = entityArg.slice(colonIdx + 1);

  if (!SUPPORTED_TYPES.includes(entityType)) {
    console.error(`Unsupported type: ${entityType}. Supported: ${SUPPORTED_TYPES.join(", ")}`);
    process.exit(1);
  }
  if (!entityRawId) {
    console.error("Entity ID is empty");
    process.exit(1);
  }

  // Validate entity exists in workspace
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  let detail: EntityDetail;
  try {
    detail = (await client.getEntityDetail(entityArg)) as EntityDetail;
  } catch (error) {
    console.error(`Entity not found or not in workspace: ${entityArg}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Generate and write CLAUDE.md
  const content = generateTemplate(entityType, detail.entity, entityRawId, projectId);
  await writeMapBlock(dir, content);

  const projectSuffix = projectId ? ` (project: ${projectId})` : "";
  console.log(`✓ Mapped ${dir}/CLAUDE.md → ${entityType}: "${detail.entity.name}"${projectSuffix}`);
}

// ---------------------------------------------------------------------------
// brain unmap <dir>
// ---------------------------------------------------------------------------

export async function runUnmap(): Promise<void> {
  const dirArg = process.argv[3];

  if (!dirArg) {
    console.error("Usage: brain unmap <directory>");
    process.exit(1);
  }

  const dir = resolve(dirArg);
  const claudeMdPath = join(dir, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) {
    console.error(`No CLAUDE.md found in ${dir}`);
    process.exit(1);
  }

  const file = Bun.file(claudeMdPath);
  let content = await file.text();

  const startIdx = content.indexOf(MAP_MARKER_START);
  const endIdx = content.indexOf(MAP_MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`No brain mapping found in ${claudeMdPath}`);
    process.exit(1);
  }

  content = (
    content.slice(0, startIdx) + content.slice(endIdx + MAP_MARKER_END.length)
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (content.length === 0) {
    unlinkSync(claudeMdPath);
    console.log(`✓ Removed ${claudeMdPath} (empty after unmap)`);
  } else {
    await Bun.write(claudeMdPath, content + "\n");
    console.log(`✓ Removed brain mapping from ${claudeMdPath}`);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function generateTemplate(
  entityType: SupportedType,
  entity: EntityDetail["entity"],
  entityRawId: string,
  projectId?: string,
): string {
  switch (entityType) {
    case "project":
      return projectTemplate(entity.name, entityRawId);
    case "feature":
      return featureTemplate(entity.name, entityRawId, projectId);
  }
}

function projectTemplate(name: string, id: string): string {
  return `# Brain: Project — "${name}"

This directory maps to brain project \`${id}\`.

**On first access**: Call \`get_project_context\` with \`project_id: "${id}"\` to load current decisions, active tasks, open questions, observations, and constraints before proceeding.

When using Brain MCP tools from this directory:
- Pass \`project_id: "${id}"\` to project-scoped tools (\`get_active_decisions\`, \`get_architecture_constraints\`, \`get_recent_changes\`)
- Pass \`project: "${id}"\` to \`check_constraints\` before architectural changes
- Scope \`create_provisional_decision\` / \`ask_question\` with \`context: { project: "${id}" }\``;
}

function featureTemplate(name: string, id: string, projectId?: string): string {
  const lines: string[] = [];
  lines.push(`# Brain: Feature — "${name}"`);
  lines.push("");
  lines.push(`This directory maps to brain feature \`${id}\`.`);

  if (projectId) {
    lines.push(`Parent project: \`${projectId}\`.`);
    lines.push("");
    lines.push(
      `**On first access**: Call \`get_project_context\` with \`project_id: "${projectId}"\` to load project-level decisions, tasks, and constraints before proceeding.`,
    );
    lines.push("");
    lines.push("When using Brain MCP tools from this directory:");
    lines.push(
      `- Pass \`project_id: "${projectId}"\` to project-scoped tools (\`get_active_decisions\`, \`get_architecture_constraints\`, \`get_recent_changes\`)`,
    );
    lines.push(
      `- Scope \`create_provisional_decision\` / \`ask_question\` with \`context: { project: "${projectId}", feature: "${id}" }\``,
    );
  } else {
    lines.push("");
    lines.push(
      `**On first access**: Call \`get_entity_detail\` with \`entity_id: "feature:${id}"\` to resolve the parent project, then call \`get_project_context\` with the resolved project ID to load decisions, tasks, and constraints.`,
    );
    lines.push("");
    lines.push("When using Brain MCP tools from this directory:");
    lines.push(
      `- Scope \`create_provisional_decision\` / \`ask_question\` with \`context: { feature: "${id}" }\``,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLAUDE.md marker write (same pattern as init.ts)
// ---------------------------------------------------------------------------

async function writeMapBlock(dir: string, content: string): Promise<void> {
  const claudeMdPath = join(dir, "CLAUDE.md");
  const file = Bun.file(claudeMdPath);
  let existing = "";

  if (await file.exists()) {
    existing = await file.text();
  }

  const brainBlock = `${MAP_MARKER_START}\n${content}\n${MAP_MARKER_END}`;

  const startIdx = existing.indexOf(MAP_MARKER_START);
  const endIdx = existing.indexOf(MAP_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    existing =
      existing.slice(0, startIdx) +
      brainBlock +
      existing.slice(endIdx + MAP_MARKER_END.length);
  } else {
    const separator =
      existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
    existing = existing + separator + brainBlock + "\n";
  }

  await Bun.write(claudeMdPath, existing);
}
