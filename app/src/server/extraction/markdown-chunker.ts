import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import type { Blockquote, Code, List, RootContent, Table } from "mdast";
import { HttpError } from "../http/errors";

export type DocumentChunk = {
  heading?: string;
  content: string;
  position: number;
};

const MAX_CHUNK_CHARS = 2400;

type Section = {
  heading?: string;
  blocks: string[];
};

export function splitDocumentIntoChunks(content: string): DocumentChunk[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    throw new HttpError(400, "uploaded file content is empty");
  }

  const ast = fromMarkdown(normalized, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const sections = accumulateSections(ast.children);
  const chunks = packChunks(sections);

  if (chunks.length === 0) {
    throw new HttpError(400, "uploaded file produced no extractable chunks");
  }

  return chunks;
}

function accumulateSections(nodes: RootContent[]): Section[] {
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentBlocks: string[] = [];

  for (const node of nodes) {
    if (node.type === "heading") {
      if (currentBlocks.length > 0) {
        sections.push({ heading: currentHeading, blocks: currentBlocks });
      }
      currentHeading = toString(node);
      currentBlocks = [];
      continue;
    }

    const text = nodeToPlaintext(node);
    if (text) {
      currentBlocks.push(text);
    }
  }

  if (currentBlocks.length > 0) {
    sections.push({ heading: currentHeading, blocks: currentBlocks });
  }

  return sections;
}

function nodeToPlaintext(node: RootContent): string | undefined {
  switch (node.type) {
    case "html":
    case "definition":
    case "thematicBreak":
      return undefined;
    case "code":
      return codeToPlaintext(node as Code);
    case "table":
      return tableToPlaintext(node as Table);
    case "list":
      return listToPlaintext(node as List);
    case "blockquote":
      return blockquoteToPlaintext(node as Blockquote);
    default:
      return toString(node) || undefined;
  }
}

function codeToPlaintext(node: Code): string | undefined {
  if (!node.value) return undefined;
  return node.lang ? `[${node.lang}]:\n${node.value}` : node.value;
}

function tableToPlaintext(node: Table): string | undefined {
  const rows = node.children;
  if (rows.length === 0) return undefined;

  const headers = rows[0].children.map((cell) => toString(cell));
  if (rows.length === 1) {
    return headers.join(", ");
  }

  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].children;
    const parts: string[] = [];
    for (let j = 0; j < cells.length; j++) {
      const header = headers[j] ?? `Column ${j + 1}`;
      parts.push(`${header}: ${toString(cells[j])}`);
    }
    lines.push(parts.join(", "));
  }
  return lines.join("\n") || undefined;
}

function listToPlaintext(node: List): string | undefined {
  const lines: string[] = [];
  for (const item of node.children) {
    const parts: string[] = [];
    for (const child of item.children) {
      if (child.type === "list") {
        const nested = listToPlaintext(child as List);
        if (nested) parts.push(nested);
      } else {
        const text = toString(child);
        if (text) parts.push(text);
      }
    }
    if (parts.length > 0) {
      lines.push(parts.join("\n"));
    }
  }
  return lines.join("\n") || undefined;
}

function blockquoteToPlaintext(node: Blockquote): string | undefined {
  const parts: string[] = [];
  for (const child of node.children) {
    const text = nodeToPlaintext(child as RootContent);
    if (text) parts.push(text);
  }
  return parts.join("\n") || undefined;
}

function packChunks(sections: Section[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let position = 0;

  for (const section of sections) {
    let accumulator = "";

    for (const block of section.blocks) {
      const candidate =
        accumulator.length > 0 ? `${accumulator}\n\n${block}` : block;

      if (candidate.length <= MAX_CHUNK_CHARS) {
        accumulator = candidate;
        continue;
      }

      // Emit current accumulator if non-empty
      if (accumulator.length > 0) {
        chunks.push({ heading: section.heading, content: accumulator, position });
        position++;
        accumulator = "";
      }

      // Handle the block that didn't fit
      if (block.length <= MAX_CHUNK_CHARS) {
        accumulator = block;
      } else {
        const subChunks = splitOversizedBlock(block);
        for (let i = 0; i < subChunks.length - 1; i++) {
          chunks.push({ heading: section.heading, content: subChunks[i], position });
          position++;
        }
        accumulator = subChunks[subChunks.length - 1];
      }
    }

    if (accumulator.length > 0) {
      chunks.push({ heading: section.heading, content: accumulator, position });
      position++;
    }
  }

  return chunks;
}

function splitOversizedBlock(text: string): string[] {
  // Try splitting at double-newline boundaries first
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return packStringSegments(paragraphs, "\n\n");
  }

  // Fall back to single-newline boundaries
  const lines = text.split("\n");
  if (lines.length > 1) {
    return packStringSegments(lines, "\n");
  }

  // Last resort: character-level splitting
  const result: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const slice = text.slice(cursor, cursor + MAX_CHUNK_CHARS).trim();
    if (slice.length > 0) {
      result.push(slice);
    }
    cursor += MAX_CHUNK_CHARS;
  }
  return result;
}

function packStringSegments(segments: string[], separator: string): string[] {
  const result: string[] = [];
  let accumulator = "";

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const candidate =
      accumulator.length > 0 ? `${accumulator}${separator}${trimmed}` : trimmed;

    if (candidate.length <= MAX_CHUNK_CHARS) {
      accumulator = candidate;
    } else {
      if (accumulator.length > 0) {
        result.push(accumulator);
      }
      // If single segment exceeds limit, include it anyway (will be split at next level)
      accumulator = trimmed;
    }
  }

  if (accumulator.length > 0) {
    result.push(accumulator);
  }

  return result;
}
