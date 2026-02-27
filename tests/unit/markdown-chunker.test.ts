import { describe, expect, it } from "bun:test";
import { splitDocumentIntoChunks } from "../../app/src/server/extraction/markdown-chunker";

describe("splitDocumentIntoChunks", () => {
  it("splits by heading sections with correct heading metadata", () => {
    const md = `# Introduction

Some intro text.

## Features

Feature list here.

### Sub-feature

Detail about sub-feature.`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks.length).toBe(3);
    expect(chunks[0].heading).toBe("Introduction");
    expect(chunks[0].content).toBe("Some intro text.");
    expect(chunks[1].heading).toBe("Features");
    expect(chunks[1].content).toBe("Feature list here.");
    expect(chunks[2].heading).toBe("Sub-feature");
    expect(chunks[2].content).toBe("Detail about sub-feature.");
  });

  it("does not treat # inside a fenced code block as a heading", () => {
    const md = `# Real Heading

Some text before code.

\`\`\`bash
# This is a comment, not a heading
echo "hello"
\`\`\`

More text after code.`;

    const chunks = splitDocumentIntoChunks(md);
    // All content should be under "Real Heading"
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading).toBe("Real Heading");
    expect(chunks[0].content).toContain("This is a comment, not a heading");
    expect(chunks[0].content).toContain("Some text before code.");
    expect(chunks[0].content).toContain("More text after code.");
  });

  it("preserves code block content with language prefix", () => {
    const md = `# Setup

\`\`\`typescript
const db = new Surreal();
await db.connect("ws://localhost:8000");
\`\`\``;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("[typescript]:");
    expect(chunks[0].content).toContain("const db = new Surreal();");
  });

  it("includes code blocks without language as-is", () => {
    const md = `# Example

\`\`\`
plain code block
\`\`\``;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("plain code block");
    expect(chunks[0].content).not.toContain("[");
  });

  it("splits oversized sections at paragraph boundaries", () => {
    const para = "A".repeat(1200);
    const md = `# Big Section

${para}

${para}

${para}`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2400);
      expect(chunk.heading).toBe("Big Section");
    }
  });

  it("converts table to Header: Value plaintext", () => {
    const md = `# Data

| Name | Status |
|------|--------|
| Alpha | Active |
| Beta | Paused |`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("Name: Alpha");
    expect(chunks[0].content).toContain("Status: Active");
    expect(chunks[0].content).toContain("Name: Beta");
    expect(chunks[0].content).toContain("Status: Paused");
  });

  it("strips link URLs, keeps link text", () => {
    const md = "We chose [SurrealDB](https://surrealdb.com) for the database.";
    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("SurrealDB");
    expect(chunks[0].content).not.toContain("https://surrealdb.com");
  });

  it("strips image URLs, keeps alt text", () => {
    const md = "Architecture: ![system diagram](https://example.com/arch.png)";
    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("system diagram");
    expect(chunks[0].content).not.toContain("https://example.com/arch.png");
  });

  it("strips HTML comments", () => {
    const md = `# Notes

<!-- TODO: remove this later -->

Actual content here.`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toBe("Actual content here.");
    expect(chunks[0].content).not.toContain("TODO");
  });

  it("handles plain text without any markdown syntax", () => {
    const text = "Just a plain text file with no markdown formatting whatsoever.";
    const chunks = splitDocumentIntoChunks(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].heading).toBeUndefined();
  });

  it("throws on empty content", () => {
    expect(() => splitDocumentIntoChunks("")).toThrow("uploaded file content is empty");
    expect(() => splitDocumentIntoChunks("   \n\n  ")).toThrow("uploaded file content is empty");
  });

  it("never produces chunks exceeding 2400 characters", () => {
    const longParagraph = "Word ".repeat(600); // ~3000 chars
    const md = `# Long

${longParagraph}`;

    const chunks = splitDocumentIntoChunks(md);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2400);
    }
  });

  it("assigns sequential 0-based positions", () => {
    const md = `# A

Text A.

# B

Text B.

# C

Text C.`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("places content before first heading in a section with undefined heading", () => {
    const md = `Some preamble text.

# First Heading

Content under heading.`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].heading).toBeUndefined();
    expect(chunks[0].content).toBe("Some preamble text.");
    expect(chunks[1].heading).toBe("First Heading");
  });

  it("extracts text from GFM task lists", () => {
    const md = `# Tasks

- [x] Deploy to staging
- [ ] Write integration tests
- [ ] Update documentation`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("Deploy to staging");
    expect(chunks[0].content).toContain("Write integration tests");
    expect(chunks[0].content).toContain("Update documentation");
  });

  it("extracts text from nested lists", () => {
    const md = `# Structure

- Backend
  - API server
  - Database layer
- Frontend
  - React app`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("Backend");
    expect(chunks[0].content).toContain("API server");
    expect(chunks[0].content).toContain("Database layer");
    expect(chunks[0].content).toContain("Frontend");
    expect(chunks[0].content).toContain("React app");
  });

  it("strips link definitions", () => {
    const md = `Check [the docs][docs] for more info.

[docs]: https://example.com/docs "Documentation"`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("the docs");
    expect(chunks[0].content).not.toContain("https://example.com/docs");
  });

  it("does not produce empty chunks for heading-only sections", () => {
    const md = `# Heading One

# Heading Two

Content under two.`;

    const chunks = splitDocumentIntoChunks(md);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading).toBe("Heading Two");
  });

  it("handles Windows line endings", () => {
    const md = "# Title\r\n\r\nContent with CRLF.\r\n";
    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].heading).toBe("Title");
    expect(chunks[0].content).toBe("Content with CRLF.");
  });

  it("handles blockquotes", () => {
    const md = `# Quotes

> This is an important decision.
> We chose to use SurrealDB.`;

    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("This is an important decision.");
    expect(chunks[0].content).toContain("We chose to use SurrealDB.");
  });

  it("strips bold and italic markers", () => {
    const md = "We **strongly** recommend using *TypeScript* for the ~~JavaScript~~ rewrite.";
    const chunks = splitDocumentIntoChunks(md);
    expect(chunks[0].content).toContain("strongly");
    expect(chunks[0].content).toContain("TypeScript");
    expect(chunks[0].content).toContain("JavaScript");
    expect(chunks[0].content).not.toContain("**");
    expect(chunks[0].content).not.toContain("*");
    expect(chunks[0].content).not.toContain("~~");
  });
});
