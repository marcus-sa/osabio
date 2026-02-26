import { describe, expect, it } from "bun:test";
import { resolvePersonReferencePatch } from "../../app/src/server/extraction/person";

describe("person resolution", () => {
  it("maps known people to record-reference fields", () => {
    const patch = resolvePersonReferencePatch({
      targetKind: "decision",
      relationshipKind: "DECIDED_BY",
      personName: "Marcus",
      personRecordId: "marcus",
    });

    expect(patch).toEqual({
      kind: "decision",
      field: "decided_by",
      value: "marcus",
    });
  });

  it("maps unresolved names to *_name fields", () => {
    const patch = resolvePersonReferencePatch({
      targetKind: "decision",
      relationshipKind: "DECIDED_BY",
      personName: "Sarah",
    });

    expect(patch).toEqual({
      kind: "decision",
      field: "decided_by_name",
      value: "Sarah",
    });
  });

  it("does not include any person-creation instruction", () => {
    const patch = resolvePersonReferencePatch({
      targetKind: "task",
      relationshipKind: "ASSIGNED_TO",
      personName: "Sarah",
    });

    expect(patch).toBeDefined();
    expect(Object.keys(patch ?? {})).not.toContain("createPerson");
  });

  it("supports multiple unresolved names in one extraction batch", () => {
    const names = ["Sarah", "Jordan", "Priya"];
    const patches = names.map((name) =>
      resolvePersonReferencePatch({
        targetKind: "question",
        relationshipKind: "ASSIGNED_TO",
        personName: name,
      }),
    );

    expect(patches).toEqual([
      { kind: "question", field: "assigned_to_name", value: "Sarah" },
      { kind: "question", field: "assigned_to_name", value: "Jordan" },
      { kind: "question", field: "assigned_to_name", value: "Priya" },
    ]);
  });
});
