import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { resolveEntityProject } from "../../app/src/server/workspace/workspace-scope";

function makeProject(id: string, name: string) {
  return { id: new RecordId("project", id), name };
}

describe("resolveEntityProject", () => {
  it("returns undefined when no projects exist", () => {
    expect(resolveEntityProject("auth feature", "We need auth", [])).toBeUndefined();
  });

  it("auto-assigns to the only project regardless of text", () => {
    const project = makeProject("p1", "Atlas");
    expect(resolveEntityProject("unrelated feature", "some text", [project])).toBe(project.id);
  });

  it("matches the correct project when one name appears in prompt text", () => {
    const atlas = makeProject("p1", "Atlas");
    const meridian = makeProject("p2", "Meridian");
    expect(resolveEntityProject("auth feature", "Atlas needs authentication", [atlas, meridian])).toBe(atlas.id);
  });

  it("returns undefined when no project name matches", () => {
    const atlas = makeProject("p1", "Atlas");
    const meridian = makeProject("p2", "Meridian");
    expect(resolveEntityProject("auth feature", "We need authentication", [atlas, meridian])).toBeUndefined();
  });

  it("returns undefined when multiple project names match (ambiguous)", () => {
    const atlas = makeProject("p1", "Atlas");
    const meridian = makeProject("p2", "Meridian");
    expect(
      resolveEntityProject("migrate data", "Move Atlas data to Meridian system", [atlas, meridian]),
    ).toBeUndefined();
  });

  it("matches case-insensitively", () => {
    const atlas = makeProject("p1", "Atlas");
    const meridian = makeProject("p2", "Meridian");
    expect(resolveEntityProject("auth feature", "atlas needs auth", [atlas, meridian])).toBe(atlas.id);
  });

  it("matches project name in entity text when not in prompt text", () => {
    const atlas = makeProject("p1", "Atlas");
    const meridian = makeProject("p2", "Meridian");
    expect(resolveEntityProject("Atlas auth feature", "We need authentication", [atlas, meridian])).toBe(atlas.id);
  });

  it("does not false-positive on short names embedded in longer words", () => {
    const app = makeProject("p1", "App");
    const meridian = makeProject("p2", "Meridian");
    // "App" should NOT match inside "Application" — word-boundary matching prevents this
    const result = resolveEntityProject("notification feature", "Application needs notifications", [app, meridian]);
    expect(result).toBeUndefined();
  });

  it("matches short names when they appear as standalone words", () => {
    const app = makeProject("p1", "App");
    const meridian = makeProject("p2", "Meridian");
    const result = resolveEntityProject("notification feature", "The App needs notifications", [app, meridian]);
    expect(result).toBe(app.id);
  });
});
